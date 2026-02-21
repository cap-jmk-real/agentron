/**
 * Exports packages/ui/public/icon.svg to assets/icon.png (512x512) for electron-builder.
 * Run from apps/desktop: node scripts/export-icon.cjs
 * Rasterizes at 2048 then downsamples to 512 for a clean, non-pixelated PNG.
 * If sharp is unavailable, writes a 256x256 placeholder PNG (electron-builder requires at least 256x256).
 */
const path = require("path");
const fs = require("fs");

const desktopRoot = path.resolve(__dirname, "..");
const inputSvg = path.join(desktopRoot, "../../packages/ui/public/icon.svg");
const outputDir = path.join(desktopRoot, "assets");
const outputPng = path.join(outputDir, "icon.png");

/** Rasterize at 4x then downsample for crisp edges (avoids 8-bit look from direct 512 raster). */
const OUTPUT_SIZE = 512;
const SUPERSAMPLE_SIZE = 2048;

function writePlaceholder256(cb) {
  fs.mkdirSync(outputDir, { recursive: true });
  try {
    const { PNG } = require("pngjs");
    const png = new PNG({ width: 256, height: 256, filterType: -1 });
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = 99; // R (indigo)
      png.data[i + 1] = 102; // G
      png.data[i + 2] = 241; // B
      png.data[i + 3] = 255; // A
    }
    png
      .pack()
      .pipe(fs.createWriteStream(outputPng))
      .on("finish", () => {
        console.warn("Wrote 256x256 placeholder icon (sharp unavailable)");
        if (cb) cb();
      })
      .on("error", (err) => {
        console.error("Placeholder icon failed:", err);
        process.exit(1);
      });
  } catch (e) {
    console.error("pngjs not available for placeholder:", e.message);
    process.exit(1);
  }
}

if (!fs.existsSync(inputSvg)) {
  console.warn("Icon SVG not found at", inputSvg);
  writePlaceholder256(() => process.exit(0));
  return;
}

let sharp;
try {
  sharp = require("sharp");
} catch (e) {
  console.warn("sharp not available:", e.message);
  writePlaceholder256(() => process.exit(0));
  return;
}

fs.mkdirSync(outputDir, { recursive: true });

sharp(inputSvg)
  .resize(SUPERSAMPLE_SIZE, SUPERSAMPLE_SIZE)
  .resize(OUTPUT_SIZE, OUTPUT_SIZE)
  .png({ compressionLevel: 9 })
  .toFile(outputPng)
  .then((info) => {
    console.log("Exported icon:", outputPng, info);
  })
  .catch((err) => {
    console.warn("Icon export failed:", err.message);
    writePlaceholder256(() => process.exit(0));
  });
