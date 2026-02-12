import nextConfig from "eslint-config-next";

const config = [...nextConfig, { ignores: ["coverage/**"] }];
export default config;
