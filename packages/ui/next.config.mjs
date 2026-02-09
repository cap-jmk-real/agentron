/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@agentron-studio/core", "@agentron-studio/runtime"],
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
