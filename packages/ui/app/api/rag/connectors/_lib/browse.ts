/**
 * Browse connector items (list only, no download/store).
 * Returns { items: { id, name, type?, path? }[], nextPageToken? } for use by GET /api/rag/connectors/:id/items and list_connector_items tool.
 */
import path from "node:path";
import fs from "node:fs";
import { google } from "googleapis";

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".pdf"]);

export type BrowseItem = { id: string; name: string; type?: string; path?: string };

export type BrowseResult = { items: BrowseItem[]; nextPageToken?: string };

export async function browseGoogleDrive(
  config: Record<string, unknown>,
  options?: { limit?: number; pageToken?: string }
): Promise<BrowseResult> {
  const folderId = (config.folderId as string) || "root";
  const serviceAccountKeyRef = config.serviceAccountKeyRef as string | undefined;
  if (!serviceAccountKeyRef || !process.env[serviceAccountKeyRef]) {
    throw new Error("Google Drive requires serviceAccountKeyRef env var");
  }
  let credentials: unknown;
  try {
    credentials = JSON.parse(process.env[serviceAccountKeyRef]!);
  } catch {
    throw new Error("Invalid service account JSON in env var");
  }
  const auth = new google.auth.GoogleAuth({
    credentials: credentials as Record<string, unknown>,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  const drive = google.drive({ version: "v3", auth });
  const q =
    folderId === "root"
      ? "'root' in parents and trashed = false"
      : `'${folderId}' in parents and trashed = false`;
  const listRes = await drive.files.list({
    q,
    pageSize: options?.limit ?? 50,
    pageToken: options?.pageToken || undefined,
    fields: "nextPageToken, files(id, name, mimeType)",
  });
  const items: BrowseItem[] = (listRes.data.files || [])
    .filter((f): f is { id: string; name: string; mimeType?: string } => !!f.id && !!f.name)
    .map((f) => ({ id: f.id, name: f.name, type: f.mimeType }));
  return {
    items,
    nextPageToken: listRes.data.nextPageToken ?? undefined,
  };
}

function getToken(config: Record<string, unknown>, refKey: string): string {
  const ref = config[refKey] as string | undefined;
  if (!ref || !process.env[ref]) throw new Error(`${refKey} env var not set`);
  return process.env[ref]!;
}

/**
 * List items for filesystem, obsidian_vault, logseq_graph. No pagination; optional limit/offset via nextPageToken as "offset:N".
 */
export function browseLocalPath(
  dirPath: string,
  extensions: Set<string> = TEXT_EXTENSIONS,
  options?: { limit?: number; pageToken?: string }
): BrowseResult {
  if (!dirPath || !path.isAbsolute(dirPath)) {
    throw new Error("Local path must be absolute");
  }
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new Error(`Path is not a directory: ${dirPath}`);
  }
  const allPaths: string[] = [];
  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && extensions.has(path.extname(e.name).toLowerCase())) {
        allPaths.push(full);
      }
    }
  }
  walk(dirPath);
  const limit = options?.limit ?? 200;
  let offset = 0;
  if (options?.pageToken?.startsWith("offset:")) {
    offset = parseInt(options.pageToken.slice(7), 10) || 0;
  }
  const slice = allPaths.slice(offset, offset + limit);
  const items: BrowseItem[] = slice.map((filePath) => ({
    id: filePath,
    name: path.basename(filePath),
    path: filePath,
  }));
  const nextOffset = offset + slice.length;
  const nextPageToken = nextOffset < allPaths.length ? `offset:${nextOffset}` : undefined;
  return { items, nextPageToken };
}

export async function browseDropbox(
  config: Record<string, unknown>,
  options?: { limit?: number; pageToken?: string }
): Promise<BrowseResult> {
  const token = getToken(config, "accessTokenRef");
  const limit = options?.limit ?? 200;
  const url = options?.pageToken
    ? "https://api.dropboxapi.com/2/files/list_folder/continue"
    : "https://api.dropboxapi.com/2/files/list_folder";
  const body = options?.pageToken
    ? { cursor: options.pageToken }
    : { path: (config.path as string) || "", limit };
  const listRes = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!listRes.ok) {
    const err = await listRes.text();
    throw new Error(`Dropbox list failed: ${listRes.status} ${err}`);
  }
  const data = (await listRes.json()) as {
    entries: { id: string; name: string; ".tag": string }[];
    has_more?: boolean;
    cursor?: string;
  };
  const items: BrowseItem[] = (data.entries || [])
    .filter((e) => e[".tag"] === "file")
    .map((e) => ({ id: e.id, name: e.name, type: "file" }));
  return {
    items,
    nextPageToken: data.has_more ? data.cursor : undefined,
  };
}

export async function browseOneDrive(
  config: Record<string, unknown>,
  options?: { limit?: number }
): Promise<BrowseResult> {
  const token = getToken(config, "accessTokenRef");
  const listRes = await fetch(
    "https://graph.microsoft.com/v1.0/me/drive/root/children?" +
      new URLSearchParams({ $top: String(options?.limit ?? 200) }),
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!listRes.ok) throw new Error(`OneDrive list failed: ${listRes.status}`);
  const list = (await listRes.json()) as {
    value?: { id: string; name: string; file?: unknown }[];
  };
  const items: BrowseItem[] = (list.value || [])
    .filter((i): i is { id: string; name: string; file: unknown } => !!i.file && !!i.id && !!i.name)
    .map((i) => ({ id: i.id, name: i.name, type: "file" }));
  return { items };
}

export async function browseNotion(
  config: Record<string, unknown>,
  options?: { limit?: number }
): Promise<BrowseResult> {
  const token = getToken(config, "accessTokenRef");
  const searchRes = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ page_size: options?.limit ?? 50 }),
  });
  if (!searchRes.ok) throw new Error(`Notion search failed: ${searchRes.status}`);
  const search = (await searchRes.json()) as {
    results?: { id: string; title?: { plain_text?: string }[] }[];
    next_cursor?: string | null;
  };
  const items: BrowseItem[] = (search.results || []).map((p) => ({
    id: p.id,
    name: p.title?.[0]?.plain_text ?? p.id,
  }));
  return {
    items,
    nextPageToken: search.next_cursor ?? undefined,
  };
}

export async function browseConfluence(
  config: Record<string, unknown>,
  options?: { limit?: number }
): Promise<BrowseResult> {
  const baseUrl = (config.baseUrl as string)?.replace(/\/$/, "") || "";
  const token = getToken(config, "accessTokenRef");
  if (!baseUrl) throw new Error("Confluence config.baseUrl required");
  const listRes = await fetch(`${baseUrl}/rest/api/content?limit=${options?.limit ?? 50}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) throw new Error(`Confluence list failed: ${listRes.status}`);
  const list = (await listRes.json()) as { results?: { id: string; title?: string }[] };
  const items: BrowseItem[] = (list.results || []).map((p) => ({
    id: p.id,
    name: p.title ?? p.id,
  }));
  return { items };
}

export async function browseGitBook(config: Record<string, unknown>): Promise<BrowseResult> {
  const token = getToken(config, "accessTokenRef");
  const listRes = await fetch("https://api.gitbook.com/v1/spaces", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) throw new Error(`GitBook spaces failed: ${listRes.status}`);
  const list = (await listRes.json()) as { items?: { uid: string; title?: string }[] };
  const items: BrowseItem[] = (list.items || []).map((s) => ({
    id: s.uid,
    name: s.title ?? s.uid,
  }));
  return { items };
}

export async function browseBookStack(config: Record<string, unknown>): Promise<BrowseResult> {
  const baseUrl = (config.baseUrl as string)?.replace(/\/$/, "") || "";
  let tokenId = (config.tokenId as string | undefined)?.trim();
  let tokenSecret = (config.tokenSecret as string | undefined)?.trim();
  if (tokenId && process.env[tokenId]) tokenId = process.env[tokenId];
  if (tokenSecret && process.env[tokenSecret]) tokenSecret = process.env[tokenSecret];
  if (!baseUrl || !tokenId || !tokenSecret) {
    throw new Error("BookStack config requires baseUrl, tokenId, tokenSecret");
  }
  const auth = "Basic " + Buffer.from(`${tokenId}:${tokenSecret}`, "utf-8").toString("base64");
  const booksRes = await fetch(`${baseUrl}/api/books`, {
    headers: { Authorization: auth },
  });
  if (!booksRes.ok) throw new Error(`BookStack books failed: ${booksRes.status}`);
  const books = (await booksRes.json()) as { data?: { id: number; name?: string }[] };
  const items: BrowseItem[] = [];
  for (const book of books.data || []) {
    const pagesRes = await fetch(`${baseUrl}/api/books/${book.id}/pages`, {
      headers: { Authorization: auth },
    });
    if (!pagesRes.ok) continue;
    const pagesData = (await pagesRes.json()) as { data?: { id: number; name?: string }[] };
    for (const p of pagesData.data || []) {
      items.push({
        id: String(p.id),
        name: p.name ?? String(p.id),
        path: book.name,
      });
    }
  }
  return { items };
}
