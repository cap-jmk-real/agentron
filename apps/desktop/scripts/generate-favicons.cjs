/**
 * Generates high-quality favicon and icon assets from packages/ui/public/icon.svg.
 * Supersamples (4x) then downscales to avoid pixelated diagonals at 16/32/48px.
 * Writes to packages/ui/public and apps/docs/public.
 * Run from repo root: node apps/desktop/scripts/generate-favicons.cjs
 * Requires: sharp, png-to-ico (desktop devDependencies).
 */
const path = require("path");
const fs = require("fs");

const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const iconSvg = path.join(repoRoot, "packages/ui/public/icon.svg");
const outDirs = [
  path.join(repoRoot, "packages/ui/public"),
  path.join(repoRoot, "apps/docs/public"),
];

const SIZES = [16, 32, 48];
const APPLE_TOUCH_SIZE = 192;
const SUPERSAMPLE = 4;

function ensureDirs() {
  for (const dir of outDirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeToAll(filename, buffer) {
  for (const dir of outDirs) {
    fs.writeFileSync(path.join(dir, filename), buffer);
  }
}

async function main() {
  if (!fs.existsSync(iconSvg)) {
    console.error("Icon SVG not found:", iconSvg);
    process.exit(1);
  }

  let sharp;
  let pngToIco;
  try {
    sharp = require("sharp");
    pngToIco = require("png-to-ico");
  } catch (e) {
    console.error(
      "Missing sharp or png-to-ico. From repo root run: pnpm install (from apps/desktop or root with deps)",
      e
    );
    process.exit(1);
  }

  ensureDirs();

  const pngBuffers = {};
  for (const size of SIZES) {
    const supersampled = await sharp(iconSvg)
      .resize(size * SUPERSAMPLE, size * SUPERSAMPLE)
      .png({ compressionLevel: 9 })
      .toBuffer();
    const buf = await sharp(supersampled)
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toBuffer();
    pngBuffers[size] = buf;
    writeToAll(`icon-${size}.png`, buf);
  }

  const appleSupersampled = await sharp(iconSvg)
    .resize(APPLE_TOUCH_SIZE * 2, APPLE_TOUCH_SIZE * 2)
    .png({ compressionLevel: 9 })
    .toBuffer();
  const appleBuf = await sharp(appleSupersampled)
    .resize(APPLE_TOUCH_SIZE, APPLE_TOUCH_SIZE)
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeToAll("apple-touch-icon.png", appleBuf);

  const ico = await pngToIco([pngBuffers[16], pngBuffers[32], pngBuffers[48]]);
  writeToAll("favicon.ico", ico);

  console.log("Favicons generated:", outDirs.map((d) => path.relative(repoRoot, d)).join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
