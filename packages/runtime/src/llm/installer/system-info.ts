import os from "node:os";
import { execSync } from "node:child_process";

export interface GpuInfo {
  available: boolean;
  name: string;
  vram: number; // bytes
  backend: "cuda" | "metal" | "rocm" | "none";
}

export interface SystemResources {
  ram: { total: number; free: number; used: number };
  disk: { total: number; free: number; path: string };
  gpu: GpuInfo[];
  platform: NodeJS.Platform;
  arch: string;
}

/**
 * Cross-platform GPU detection. Driver installation and chip vendors differ widely:
 * - macOS: Apple Silicon uses Metal; Intel Macs may have AMD/NVIDIA (depends on model).
 * - Linux: NVIDIA (nvidia-smi, driver version varies), AMD (rocm-smi or amdgpu), Intel (intel_gpu_top).
 * - Windows: NVIDIA/AMD/Intel via drivers; nvidia-smi only if CUDA drivers installed.
 * - WSL: nvidia-smi often available if host has NVIDIA + WSL2 GPU support.
 * We try multiple methods and never assume a single tool exists.
 */
function detectGpu(): GpuInfo[] {
  const gpus: GpuInfo[] = [];
  const platform = os.platform();

  if (platform === "darwin") {
    // macOS: Apple Silicon = Metal + unified memory. Intel Macs = discrete GPU (varies).
    try {
      const cpuModel = (os.cpus()[0]?.model ?? "").toLowerCase();
      const isArm = os.arch() === "arm64";
      if (cpuModel.includes("apple") || isArm) {
        gpus.push({
          available: true,
          name: `Apple Silicon (${cpuModel.split(" ").slice(-1)[0] || "M-series"})`,
          vram: os.totalmem(),
          backend: "metal",
        });
      }
      // Intel Mac: could have AMD GPU; we don't run amd/rocm on macOS typically, skip extra checks
    } catch { /* no GPU info */ }
  }

  if (platform === "linux" || platform === "win32") {
    // NVIDIA: try on every call (no cache) so that newly installed drivers are detected when the user reopens the page/app
    const nvidiaCmds = platform === "win32" ? ["nvidia-smi"] : ["nvidia-smi", "/usr/bin/nvidia-smi", "/usr/lib/nvidia/bin/nvidia-smi"];
    for (const cmd of nvidiaCmds) {
      try {
        const output = execSync(`${cmd} --query-gpu=name,memory.total --format=csv,noheader,nounits`, { timeout: 5000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
        const lines = output.split("\n").filter((l) => l && !l.startsWith("name,"));
        for (const line of lines) {
          const parts = line.split(",").map((s) => s.trim());
          const name = parts[0];
          const vramMb = parts[1] ? parseInt(parts[1], 10) : 0;
          if (name && !isNaN(vramMb)) {
            gpus.push({ available: true, name, vram: vramMb * 1024 * 1024, backend: "cuda" });
          }
        }
        if (gpus.length > 0) break;
      } catch { continue; }
    }

    // AMD ROCm (Linux) or AMD on Windows (no standard CLI; skip or use wmic)
    if (gpus.length === 0 && platform === "linux") {
      try {
        const out = execSync("which rocm-smi 2>/dev/null && rocm-smi --showmeminfo vram 2>/dev/null || true", { timeout: 5000, shell: "/bin/sh", encoding: "utf8" });
        if (out.includes("vram") || out.includes("VRAM")) {
          gpus.push({ available: true, name: "AMD GPU (ROCm)", vram: 0, backend: "rocm" });
        }
      } catch { /* ignore */ }
    }

    // Intel GPU (Linux: intel_gpu_top or sysfs)
    if (gpus.length === 0 && platform === "linux") {
      try {
        const hasIntel = execSync("ls /dev/dri/renderD* 2>/dev/null | head -1", { timeout: 2000, shell: "/bin/sh", encoding: "utf8" }).trim();
        if (hasIntel) {
          gpus.push({ available: true, name: "Intel GPU", vram: 0, backend: "none" });
        }
      } catch { /* ignore */ }
    }
  }

  if (gpus.length === 0) {
    gpus.push({ available: false, name: "No GPU detected (drivers may vary by OS)", vram: 0, backend: "none" });
  }

  return gpus;
}

function getDiskSpace(targetPath?: string): { total: number; free: number; path: string } {
  const platform = os.platform();
  const checkPath = targetPath ?? os.homedir();

  try {
    if (platform === "win32") {
      const drive = checkPath.slice(0, 2);
      const output = execSync(`wmic logicaldisk where "DeviceID='${drive}'" get Size,FreeSpace /format:csv`, { timeout: 5000 }).toString();
      const lines = output.trim().split("\n").filter(Boolean);
      const lastLine = lines[lines.length - 1];
      const parts = lastLine.split(",");
      return { total: parseInt(parts[2] || "0", 10), free: parseInt(parts[1] || "0", 10), path: drive };
    } else {
      const output = execSync(`df -k "${checkPath}" | tail -1`, { timeout: 5000 }).toString().trim();
      const parts = output.split(/\s+/);
      const total = parseInt(parts[1] || "0", 10) * 1024;
      const free = parseInt(parts[3] || "0", 10) * 1024;
      return { total, free, path: checkPath };
    }
  } catch {
    return { total: 0, free: 0, path: checkPath };
  }
}

export async function getSystemResources(): Promise<SystemResources> {
  const ram = {
    total: os.totalmem(),
    free: os.freemem(),
    used: os.totalmem() - os.freemem(),
  };

  // Check disk space where Ollama stores models
  const ollamaDir = process.env.OLLAMA_MODELS
    ?? (os.platform() === "darwin" || os.platform() === "linux"
      ? `${os.homedir()}/.ollama/models`
      : `${os.homedir()}\\.ollama\\models`);
  const disk = getDiskSpace(ollamaDir);

  const gpu = detectGpu();

  return {
    ram,
    disk,
    gpu,
    platform: os.platform(),
    arch: os.arch(),
  };
}

export interface ModelRequirements {
  parameterSize: string;
  diskSize: number;
  ramMinimum: number;
  vramRecommended: number;
  quantization: string;
}

/**
 * Estimate resource requirements based on parameter count.
 * Rule of thumb: ~0.5 bytes/param at Q4, +20% overhead for KV cache.
 */
export function estimateRequirements(parameterSize: string): ModelRequirements {
  const match = parameterSize.match(/([\d.]+)\s*[bB]/);
  const billions = match ? parseFloat(match[1]) : 7;
  const bytesPerParam = 0.5; // Q4 quantization

  const diskSize = Math.round(billions * bytesPerParam * 1e9);
  const ramMinimum = Math.round(diskSize * 1.2);
  const vramRecommended = Math.round(diskSize * 1.1);

  return {
    parameterSize,
    diskSize,
    ramMinimum,
    vramRecommended,
    quantization: "Q4_K_M",
  };
}

export interface CompatibilityResult {
  canRun: boolean;
  canRunOnGpu: boolean;
  warnings: string[];
  system: SystemResources;
  requirements: ModelRequirements;
  recommendedGpuLayers: number;
}

const fmtBytes = (bytes: number) => {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${bytes} bytes`;
};

export async function checkCompatibility(parameterSize: string): Promise<CompatibilityResult> {
  const system = await getSystemResources();
  const requirements = estimateRequirements(parameterSize);
  const warnings: string[] = [];

  const canRun = system.ram.free >= requirements.ramMinimum * 0.7; // Allow some flexibility
  if (!canRun) {
    warnings.push(`Model needs ~${fmtBytes(requirements.ramMinimum)} RAM but only ${fmtBytes(system.ram.free)} is free`);
  }

  if (system.disk.free < requirements.diskSize) {
    warnings.push(`Model needs ~${fmtBytes(requirements.diskSize)} disk but only ${fmtBytes(system.disk.free)} is free`);
  }

  const primaryGpu = system.gpu.find((g) => g.available) ?? system.gpu[0];
  const canRunOnGpu = primaryGpu.available && primaryGpu.vram >= requirements.vramRecommended;
  let recommendedGpuLayers = 0;

  if (primaryGpu.available && primaryGpu.vram > 0) {
    if (canRunOnGpu) {
      recommendedGpuLayers = -1; // All layers
    } else {
      // Partial offload: estimate how many layers fit in VRAM
      // Rough estimate: 40 layers for a typical transformer
      const totalLayers = 40;
      const layerFraction = primaryGpu.vram / requirements.vramRecommended;
      recommendedGpuLayers = Math.min(Math.floor(totalLayers * layerFraction), totalLayers);
      if (recommendedGpuLayers > 0) {
        warnings.push(`Full GPU offload needs ~${fmtBytes(requirements.vramRecommended)} VRAM (have ${fmtBytes(primaryGpu.vram)}). Recommend ${recommendedGpuLayers} layers on GPU.`);
      }
    }
  } else if (!primaryGpu.available) {
    warnings.push("No GPU detected. Model will run on CPU only.");
  }

  return { canRun: canRun || system.ram.total >= requirements.ramMinimum, canRunOnGpu, warnings, system, requirements, recommendedGpuLayers };
}
