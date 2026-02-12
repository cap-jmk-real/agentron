/**
 * Exports packages/ui/assets/icon.svg to assets/icon.png (512x512) for electron-builder.
 * Run from apps/desktop: node scripts/export-icon.cjs
 * If sharp is unavailable (e.g. Windows without native deps), writes a minimal placeholder PNG so the path exists.
 */
const path = require("path");
const fs = require("fs");

const desktopRoot = path.resolve(__dirname, "..");
const inputSvg = path.join(desktopRoot, "../../packages/ui/assets/icon.svg");
const outputDir = path.join(desktopRoot, "assets");
const outputPng = path.join(outputDir, "icon.png");

// Minimal 512x512 transparent PNG (single pixel, then scaled by electron-builder or used as placeholder)
const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function writeMinimalPng() {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPng, MINIMAL_PNG);
  console.warn("Wrote minimal placeholder icon (sharp unavailable)");
}

if (!fs.existsSync(inputSvg)) {
  console.warn("Icon SVG not found at", inputSvg);
  writeMinimalPng();
  process.exit(0);
}

let sharp;
try {
  sharp = require("sharp");
} catch (e) {
  console.warn("sharp not available:", e.message);
  writeMinimalPng();
  process.exit(0);
}

fs.mkdirSync(outputDir, { recursive: true });

sharp(inputSvg)
  .resize(512, 512)
  .png()
  .toFile(outputPng)
  .then((info) => console.log("Exported icon:", outputPng, info))
  .catch((err) => {
    console.warn("Icon export failed:", err.message);
    writeMinimalPng();
    process.exit(0);
  });
