/** @type {import('next').NextConfig} */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Alias node: built-ins so chunk filenames don't contain ":" (invalid on Windows/NTFS).
const nodeBuiltinAliases = {
  "node:crypto": "crypto",
  "node:inspector": "inspector",
};

const monorepoRoot = path.join(__dirname, "..", "..");

const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@agentron-studio/core", "@agentron-studio/runtime"],
  serverExternalPackages: ["better-sqlite3", "playwright"],
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    resolveAlias: nodeBuiltinAliases,
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...nodeBuiltinAliases,
    };
    return config;
  },
};

export default nextConfig;
