/**
 * Extract plain text from document buffers by mime type for RAG chunking.
 * Used before chunking in ingest when mimeType is set.
 */

/** Strip HTML tags to get approximate text content. */
function stripHtml(html: string): string {
  return html
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize mime type for branching (lowercase, without params). */
function normalizeMime(mimeType: string | null): string {
  if (!mimeType) return "";
  return mimeType.split(";")[0].trim().toLowerCase();
}

/**
 * Extract plain text from a document buffer using mime type.
 * - application/pdf: uses pdf-parse if available
 * - text/html: strip tags
 * - text/markdown, text/plain, text/*: utf-8 decode
 * - unknown: utf-8 decode
 */
export async function extractText(buffer: Buffer, mimeType: string | null): Promise<string> {
  const mime = normalizeMime(mimeType);
  if (mime === "text/html") {
    const html = buffer.toString("utf-8");
    return stripHtml(html);
  }
  if (mime === "application/pdf") {
    try {
      const pdfParse = await import("pdf-parse");
      const data = await pdfParse.default(buffer);
      return typeof data?.text === "string" ? data.text.trim() : "";
    } catch {
      return buffer.toString("utf-8");
    }
  }
  return buffer.toString("utf-8");
}
