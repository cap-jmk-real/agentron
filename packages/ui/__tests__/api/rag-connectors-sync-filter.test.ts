import { describe, it, expect } from "vitest";
import {
  filterSyncItems,
  type ItemWithIdAndName,
} from "../../app/api/rag/connectors/_lib/sync-filter";

const items: ItemWithIdAndName[] = [
  { id: "id-a", name: "file-a.txt", path: "/docs/file-a.txt" },
  { id: "id-b", name: "readme.md", path: "/docs/readme.md" },
  { id: "id-c", name: "notes.md", path: "/notes/notes.md" },
  { id: "id-d", name: "backup.tmp", path: "/tmp/backup.tmp" },
];

describe("filterSyncItems", () => {
  it("returns all items when config is empty", () => {
    expect(filterSyncItems(items, {})).toEqual(items);
    expect(filterSyncItems(items, { other: true })).toEqual(items);
  });

  it("returns all items when includeIds is empty array", () => {
    expect(filterSyncItems(items, { includeIds: [] })).toEqual(items);
  });

  it("returns only items whose id is in includeIds when includeIds is non-empty", () => {
    expect(filterSyncItems(items, { includeIds: ["id-a", "id-c"] })).toEqual([items[0], items[2]]);
    expect(filterSyncItems(items, { includeIds: ["id-b"] })).toEqual([items[1]]);
    expect(filterSyncItems(items, { includeIds: ["id-x"] })).toEqual([]);
  });

  it("ignores non-string entries in includeIds", () => {
    expect(
      filterSyncItems(items, { includeIds: ["id-a", 1, null, "id-c", undefined, ""] as unknown[] })
    ).toEqual([items[0], items[2]]);
  });

  it("excludes items whose name or path matches excludePatterns", () => {
    expect(filterSyncItems(items, { excludePatterns: ["*.tmp"] })).toEqual([
      items[0],
      items[1],
      items[2],
    ]);
    expect(filterSyncItems(items, { excludePatterns: ["*.md"] })).toEqual([items[0], items[3]]);
    expect(filterSyncItems(items, { excludePatterns: ["/tmp/*"] })).toEqual([
      items[0],
      items[1],
      items[2],
    ]);
  });

  it("excludePatterns matches on path when present, else name", () => {
    const withPath = [
      { id: "1", name: "same.txt", path: "/a/same.txt" },
      { id: "2", name: "same.txt", path: "/b/same.txt" },
    ];
    expect(filterSyncItems(withPath, { excludePatterns: ["/b/*"] })).toEqual([withPath[0]]);
    const noPath = [
      { id: "1", name: "foo.txt" },
      { id: "2", name: "bar.txt" },
    ];
    expect(filterSyncItems(noPath, { excludePatterns: ["foo*"] })).toEqual([noPath[1]]);
  });

  it("applies includeIds first then excludePatterns when both set", () => {
    const result = filterSyncItems(items, {
      includeIds: ["id-a", "id-b", "id-c"],
      excludePatterns: ["*.md"],
    });
    expect(result).toEqual([items[0]]);
  });

  it("ignores non-string entries in excludePatterns", () => {
    expect(
      filterSyncItems(items, {
        excludePatterns: ["*.tmp", 1, null] as unknown[],
      })
    ).toEqual([items[0], items[1], items[2]]);
  });

  it("returns empty array when includeIds matches nothing", () => {
    expect(filterSyncItems(items, { includeIds: ["none"] })).toEqual([]);
  });

  it("preserves extra properties on items (generic T)", () => {
    const extended = items.map((i) => ({ ...i, mimeType: "text/plain" }));
    const result = filterSyncItems(extended, { includeIds: ["id-a"] });
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty("mimeType", "text/plain");
  });
});
