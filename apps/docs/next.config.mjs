import nextra from "nextra";

const withNextra = nextra({
  // Nextra 4: theme is applied via Layout in app/layout.tsx.
  defaultShowCopyCode: true,
});

// Next.js basePath must not end with / (see https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath)
const basePath = (process.env.BASE_PATH || "").replace(/\/+$/, "") || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath: basePath || undefined,
  assetPrefix: basePath ? `${basePath}/` : undefined,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default withNextra(nextConfig);
