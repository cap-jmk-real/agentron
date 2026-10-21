import type { MetadataRoute } from "next";
import { getDocsRoutes } from "../lib/docs-routes";

export const dynamic = "force-static";

const SITE_URL = "https://docs.agentron.rocks";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return getDocsRoutes().map((route) => ({
    url: `${SITE_URL}${route === "/" ? "/" : route}`,
    lastModified,
    changeFrequency: "weekly",
    priority: route === "/" ? 1 : 0.7,
  }));
}
