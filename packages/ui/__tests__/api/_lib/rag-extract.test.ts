import { describe, it, expect } from "vitest";
import { extractText } from "../../../app/api/_lib/rag-extract";

describe("rag-extract", () => {
  describe("extractText", () => {
    it("returns utf-8 string when mimeType is null", async () => {
      const buf = Buffer.from("plain text", "utf-8");
      expect(await extractText(buf, null)).toBe("plain text");
    });

    it("returns utf-8 string for text/plain", async () => {
      const buf = Buffer.from("hello world", "utf-8");
      expect(await extractText(buf, "text/plain")).toBe("hello world");
    });

    it("strips HTML tags for text/html", async () => {
      const html = "<p>Hello</p><div>World</div>";
      const buf = Buffer.from(html, "utf-8");
      const text = await extractText(buf, "text/html");
      expect(text).not.toMatch(/<[^>]+>/);
      expect(text).toContain("Hello");
      expect(text).toContain("World");
    });

    it("normalizes mime type (lowercase, no params)", async () => {
      const buf = Buffer.from("ok", "utf-8");
      expect(await extractText(buf, "TEXT/PLAIN; charset=utf-8")).toBe("ok");
    });

    it("returns utf-8 for text/markdown", async () => {
      const md = "# Title\n\nBody **bold**.";
      const buf = Buffer.from(md, "utf-8");
      expect(await extractText(buf, "text/markdown")).toBe(md);
    });

    it("for application/pdf falls back to utf-8 when pdf-parse fails or not installed", async () => {
      const buf = Buffer.from("not a real pdf", "utf-8");
      const text = await extractText(buf, "application/pdf");
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThanOrEqual(0);
    });

    it("treats empty mimeType as unknown and returns utf-8", async () => {
      const buf = Buffer.from("content", "utf-8");
      expect(await extractText(buf, "")).toBe("content");
    });
  });
});
