#!/usr/bin/env node
/**
 * Reads Vitest/Istanbul coverage-summary.json and writes badges/coverage.json
 * for the shields.io endpoint badge (custom styling: flat-square, color by threshold).
 * Run after test:coverage; expects COVERAGE_SUMMARY_PATH or packages/ui/coverage/coverage-summary.json.
 */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const defaultPath = path.join(root, "packages", "ui", "coverage", "coverage-summary.json");
const summaryPath = process.env.COVERAGE_SUMMARY_PATH || defaultPath;

if (!fs.existsSync(summaryPath)) {
  console.error("write-coverage-badge: coverage summary not found at", summaryPath);
  process.exit(1);
}

const raw = fs.readFileSync(summaryPath, "utf8");
const summary = JSON.parse(raw);
const total = summary.total;
if (!total) {
  console.error("write-coverage-badge: no 'total' in coverage summary");
  process.exit(1);
}

// Use lines pct (primary threshold in this repo); fallback to statements then branches
const pct =
  total.lines?.pct != null
    ? total.lines.pct
    : total.statements?.pct != null
      ? total.statements.pct
      : total.branches?.pct != null
        ? total.branches.pct
        : (total.functions?.pct ?? 0);

const value = Number.isFinite(pct) ? `${Math.round(pct)}%` : "n/a";
// Match threshold: green >= 70%, yellow 50–69%, red < 50%
const color = pct >= 70 ? "22c55e" : pct >= 50 ? "eab308" : "ef4444";

const badge = {
  schemaVersion: 1,
  label: "coverage",
  message: value,
  color,
  style: "flat-square",
};

const badgesDir = path.join(root, "badges");
if (!fs.existsSync(badgesDir)) fs.mkdirSync(badgesDir, { recursive: true });
fs.writeFileSync(path.join(badgesDir, "coverage.json"), JSON.stringify(badge) + "\n", "utf8");
console.log("wrote badges/coverage.json:", value, color);
