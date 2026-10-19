import fs from "node:fs";
import path from "node:path";

const CONTENT_DIR = path.join(process.cwd(), "content");

/** Static export paths for all MDX pages (trailing slash, matches next.config trailingSlash). */
export function getDocsRoutes(): string[] {
  const routes = new Set<string>(["/"]);

  function walk(dir: string, urlPrefix: string) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith("_") || ent.name.startsWith(".")) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full, `${urlPrefix}/${ent.name}`);
        continue;
      }
      if (!ent.name.endsWith(".mdx")) continue;
      const slug = ent.name.replace(/\.mdx$/, "");
      if (slug === "index") {
        if (urlPrefix) routes.add(`${urlPrefix}/`);
      } else {
        routes.add(`${urlPrefix}/${slug}/`);
      }
    }
  }

  walk(CONTENT_DIR, "");
  return [...routes].sort();
}
