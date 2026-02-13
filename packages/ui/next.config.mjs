/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@agentron-studio/core", "@agentron-studio/runtime"],
  serverExternalPackages: ["better-sqlite3"],
  // Exclude node:crypto chunk from standalone trace on Windows (filename contains ":" which is invalid there).
  // At runtime Node resolves node:crypto as a built-in, so the app still works.
  outputFileTracingExcludes: {
    "*": [".next/server/chunks/*node*crypto*"],
  },
};

export default nextConfig;
