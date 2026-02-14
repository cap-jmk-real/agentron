/** @type {import('next').NextConfig} */
// Alias node: built-ins so chunk filenames don't contain ":" (invalid on Windows/NTFS).
const nodeBuiltinAliases = {
  "node:crypto": "crypto",
  "node:inspector": "inspector",
};

const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@agentron-studio/core", "@agentron-studio/runtime"],
  serverExternalPackages: ["better-sqlite3"],
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
