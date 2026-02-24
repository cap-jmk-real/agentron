/**
 * Selective sync: filter items by config.includeIds and config.excludePatterns.
 * - includeIds (string[]): if non-empty, only items whose id is in this set are kept.
 * - excludePatterns (string[]): glob-like patterns; items whose name or path matches any are excluded.
 */
export type ItemWithIdAndName = { id: string; name: string; path?: string };

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesPattern(nameOrPath: string, pattern: string): boolean {
  try {
    const re = globToRegex(pattern);
    return re.test(nameOrPath);
  } catch {
    return false;
  }
}

/**
 * Filter items for sync. If includeIds is set and non-empty, only those ids are kept.
 * If excludePatterns is set and non-empty, items whose name or path matches any pattern are removed.
 */
export function filterSyncItems<T extends ItemWithIdAndName>(
  items: T[],
  config: Record<string, unknown>
): T[] {
  let list = items;
  const includeIds = config.includeIds;
  if (Array.isArray(includeIds) && includeIds.length > 0) {
    const set = new Set(includeIds.filter((x): x is string => typeof x === "string"));
    list = list.filter((item) => set.has(item.id));
  }
  const excludePatterns = config.excludePatterns;
  if (Array.isArray(excludePatterns) && excludePatterns.length > 0) {
    const patterns = excludePatterns.filter((x): x is string => typeof x === "string");
    list = list.filter((item) => {
      const nameOrPath = item.path ?? item.name;
      return !patterns.some((p) => matchesPattern(nameOrPath, p));
    });
  }
  return list;
}
