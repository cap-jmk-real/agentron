#!/usr/bin/env node
/**
 * CI-only version bump guard.
 *
 * In GitHub Actions, fails when the current root package.json version
 * matches the latest GitHub Release version (tag_name).
 *
 * Locally (outside Actions) this script is a no-op.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const inCi = process.env.GITHUB_ACTIONS === "true";

if (!inCi) {
  console.log("Version guard: not running in GitHub Actions, skipping.");
  process.exit(0);
}

function getCurrentVersion() {
  const pkgPath = join(root, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  return String(pkg.version);
}

async function getLatestReleaseVersionFromGithub() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;

  if (!repo || !token) {
    console.error(
      [
        "Version guard: GITHUB_REPOSITORY or GITHUB_TOKEN is not set in CI.",
        "Ensure the workflow is running in GitHub Actions with the default token enabled.",
      ].join("\n")
    );
    process.exit(1);
  }

  const url = `https://api.github.com/repos/${repo}/releases/latest`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "agentron-version-guard",
        Accept: "application/vnd.github+json",
      },
    });

    if (!res.ok) {
      console.warn(
        `Version guard: GitHub Releases API returned ${res.status}. Allowing CI to continue.`
      );
      return null;
    }

    const data = await res.json();
    const tag = data.tag_name;
    if (!tag) return null;

    return tag.startsWith("v") ? tag.slice(1) : String(tag);
  } catch (err) {
    console.warn(
      `Version guard: failed to read latest GitHub release (${String(err)}). Allowing CI to continue.`
    );
    return null;
  }
}

const current = getCurrentVersion();
const latest = await getLatestReleaseVersionFromGithub();

if (!latest) {
  console.log(
    `Version guard: no latest GitHub release version found. Current version is ${current}. Allowing CI to continue.`
  );
  process.exit(0);
}

if (current === latest) {
  console.error(
    [
      `Current version ${current} matches latest GitHub release version ${latest}.`,
      `Every merge to main must bump the version. Please run:`,
      `  npm run release:bump [patch|minor|major]`,
      `then commit and push again.`,
    ].join("\n")
  );
  process.exit(1);
}

console.log(
  `Version guard OK: current version ${current} differs from latest GitHub release version ${latest}.`
);
