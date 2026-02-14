#!/usr/bin/env node
/**
 * Bump version across all release-relevant package.json files.
 * Usage: node scripts/bump-version.mjs [patch|minor|major]
 * Default: patch
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const PACKAGES = [
  'package.json',
  'packages/ui/package.json',
  'apps/desktop/package.json',
  'apps/docs/package.json',
];

function parseVersion(ver) {
  const m = String(ver).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`Invalid semver: ${ver}`);
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function bump(version, kind) {
  const [major, minor, patch] = parseVersion(version);
  switch (kind) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

const kind = (process.argv[2] || 'patch').toLowerCase();
if (!['patch', 'minor', 'major'].includes(kind)) {
  console.error('Usage: node scripts/bump-version.mjs [patch|minor|major]');
  process.exit(1);
}

const rootPkgPath = join(root, 'package.json');
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
const current = rootPkg.version;
const next = bump(current, kind);

console.log(`Bumping ${current} → ${next} (${kind})`);

for (const rel of PACKAGES) {
  const p = join(root, rel);
  const pkg = JSON.parse(readFileSync(p, 'utf-8'));
  pkg.version = next;
  writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  console.log(`  Updated ${rel}`);
}

console.log(`\nNext: commit and merge to main:`);
console.log(`  git add -A && git commit -m "chore(release): v${next}"`);
console.log(`  git push origin <branch>`);
console.log(`  Then merge to main (via PR or direct) — the release will be created automatically.`);
