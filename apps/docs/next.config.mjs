import nextra from "nextra";

const withNextra = nextra({
  // Nextra 4: theme is applied via Layout in app/layout.tsx.
  defaultShowCopyCode: true,
});

const basePath = process.env.BASE_PATH || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath: basePath || undefined,
  assetPrefix: basePath ? `${basePath}/` : undefined,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default withNextra(nextConfig);
