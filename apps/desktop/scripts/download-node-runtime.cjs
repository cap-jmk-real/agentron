/**
 * Downloads Node.js for the current platform and extracts it into
 * node-runtime-<platform> so the installer can bundle it (no separate Node install).
 * Version is read from repo root .nvmrc (same as development). Fallback: 22.12.0.
 * Run from apps/desktop: node scripts/download-node-runtime.cjs
 * Then run dist so extraResources includes app/node.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const nvmrcPath = path.join(repoRoot, ".nvmrc");
const DEFAULT_NODE_VERSION = "22.12.0";

function getNodeVersion() {
  if (!fs.existsSync(nvmrcPath)) return DEFAULT_NODE_VERSION;
  const raw = fs.readFileSync(nvmrcPath, "utf8").trim();
  const match = raw.match(/^v?(\d+\.\d+\.\d+)$/) || raw.match(/^(\d+)\.?$/);
  if (!match) return DEFAULT_NODE_VERSION;
  const v = match[1];
  if (v.includes(".")) return v;
  if (v === "22") return "22.12.0";
  if (v === "20") return "20.18.0";
  return `${v}.0.0`;
}

const NODE_VERSION = getNodeVersion();
const BASE = `https://nodejs.org/dist/v${NODE_VERSION}`;
const desktopDir = path.resolve(__dirname, "..");

const platform = process.platform;
const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : "x64";

function getUrl() {
  if (platform === "win32") {
    return `${BASE}/node-v${NODE_VERSION}-win-${arch}.zip`;
  }
  if (platform === "darwin") {
    return `${BASE}/node-v${NODE_VERSION}-darwin-${arch}.tar.gz`;
  }
  if (platform === "linux") {
    return `${BASE}/node-v${NODE_VERSION}-linux-${arch}.tar.gz`;
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

function download(url) {
  return new Promise((resolve, reject) => {
    const file = path.join(desktopDir, "node-runtime-download");
    const stream = fs.createWriteStream(file);
    https
      .get(url, { headers: { "User-Agent": "Agentron-Desktop" } }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${res.statusCode} ${url}`));
          return;
        }
        res.pipe(stream);
        stream.on("finish", () => {
          stream.close();
          resolve(file);
        });
      })
      .on("error", reject);
  });
}

function extractZip(zipPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  if (process.platform === "win32") {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force"`,
      {
        stdio: "inherit",
      }
    );
  } else {
    execSync(`unzip -o "${zipPath}" -d "${outDir}"`, { stdio: "inherit" });
  }
  const entries = fs.readdirSync(outDir);
  const top = entries.find((e) => e.startsWith("node-"));
  if (!top) return;
  const extracted = path.join(outDir, top);
  const nodeExe = path.join(extracted, "node.exe");
  if (fs.existsSync(nodeExe)) {
    fs.renameSync(nodeExe, path.join(outDir, "node.exe"));
  }
  fs.rmSync(extracted, { recursive: true, force: true });
}

function extractTarball(tarPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  execSync(`tar -xzf "${tarPath}" -C "${outDir}"`, { stdio: "inherit" });
  const entries = fs.readdirSync(outDir);
  const top = entries.find((e) => e.startsWith("node-"));
  if (!top) return;
  const extracted = path.join(outDir, top);
  const binNode = path.join(extracted, "bin", "node");
  if (fs.existsSync(binNode)) {
    const destBin = path.join(outDir, "bin");
    fs.mkdirSync(destBin, { recursive: true });
    fs.renameSync(binNode, path.join(destBin, "node"));
  }
  fs.rmSync(extracted, { recursive: true, force: true });
}

async function main() {
  const dirName = `node-runtime-${platform === "win32" ? "win" : platform === "darwin" ? "darwin" : "linux"}`;
  const outDir = path.join(desktopDir, dirName);
  const url = getUrl();
  console.log("Downloading Node.js", NODE_VERSION, "for", platform, arch, "...");
  console.log(url);
  const file = await download(url);
  console.log("Extracting to", outDir, "...");
  if (path.extname(file) === ".zip") {
    if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
    extractZip(file, outDir);
  } else {
    if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
    extractTarball(file, outDir);
  }
  fs.unlinkSync(file);
  console.log("Done. Node runtime is in", dirName);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
