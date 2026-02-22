/**
 * Cloud connector sync: Dropbox, OneDrive, Notion, Confluence, GitBook, BookStack.
 * Uses fetch so tests can mock. Each returns { synced, total } or throws.
 * Optional config.includeIds and config.excludePatterns filter which items are synced.
 */
import path from "node:path";
import { filterSyncItems } from "./sync-filter";
import fs from "node:fs";
import { putObject } from "../../../_lib/s3";
import { getRagUploadsDir } from "../../../_lib/db";
import { ragDocuments } from "@agentron-studio/core";
import { db } from "../../../_lib/db";

type StoreRow = {
  id: string;
  type: string;
  bucket: string;
  region: string | null;
  endpoint: string | null;
  credentialsRef: string | null;
};

function getToken(config: Record<string, unknown>, refKey: string): string {
  const ref = config[refKey] as string | undefined;
  if (!ref || !process.env[ref]) throw new Error(`${refKey} env var not set`);
  return process.env[ref]!;
}

async function writeToStore(
  useS3: boolean,
  store: StoreRow,
  storePath: string,
  localStorePath: string,
  buffer: Buffer,
  mimeType: string,
  collectionId: string
): Promise<string> {
  if (useS3) {
    await putObject(
      {
        id: store.id,
        type: store.type,
        bucket: store.bucket,
        region: store.region,
        endpoint: store.endpoint,
        credentialsRef: store.credentialsRef,
      },
      storePath,
      buffer,
      mimeType
    );
    return storePath;
  }
  const dir = path.join(getRagUploadsDir(), collectionId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fileName = localStorePath.replace(/^uploads\//, "");
  fs.writeFileSync(path.join(dir, fileName), buffer);
  return localStorePath;
}

export async function syncDropbox(
  config: Record<string, unknown>,
  connectorId: string,
  collectionId: string,
  store: StoreRow,
  useS3: boolean
): Promise<{ synced: number; total: number }> {
  const token = getToken(config, "accessTokenRef");
  const folderPath = (config.path as string) || "";
  const listRes = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: folderPath || "" }),
  });
  if (!listRes.ok) {
    const err = await listRes.text();
    throw new Error(`Dropbox list_folder failed: ${listRes.status} ${err}`);
  }
  const list = (await listRes.json()) as {
    entries: { id: string; name: string; ".tag": string }[];
  };
  const allFiles = (list.entries || []).filter((e) => e[".tag"] === "file");
  const files = filterSyncItems(allFiles, config);
  let synced = 0;
  for (const file of files) {
    const downRes = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Dropbox-API-Arg": JSON.stringify({
          path: `${folderPath}/${file.name}`.replace(/\/+/g, "/"),
        }),
      },
    });
    if (!downRes.ok) continue;
    const buffer = Buffer.from(await downRes.arrayBuffer());
    const docId = crypto.randomUUID();
    const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storePath = `connectors/${connectorId}/${file.id}_${sanitized}`;
    const localStorePath = `uploads/${docId}_${sanitized}`;
    const mimeType = "application/octet-stream";
    const finalPath = await writeToStore(
      useS3,
      store,
      storePath,
      localStorePath,
      buffer,
      mimeType,
      collectionId
    );
    await db
      .insert(ragDocuments)
      .values({
        id: docId,
        collectionId,
        externalId: file.id,
        storePath: finalPath,
        mimeType,
        metadata: JSON.stringify({ source: "dropbox", name: file.name }),
        createdAt: Date.now(),
      })
      .run();
    synced++;
  }
  return { synced, total: files.length };
}

export async function syncOneDrive(
  config: Record<string, unknown>,
  connectorId: string,
  collectionId: string,
  store: StoreRow,
  useS3: boolean
): Promise<{ synced: number; total: number }> {
  const token = getToken(config, "accessTokenRef");
  const listRes = await fetch("https://graph.microsoft.com/v1.0/me/drive/root/children", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) throw new Error(`OneDrive list failed: ${listRes.status}`);
  const list = (await listRes.json()) as { value?: { id: string; name: string; file?: unknown }[] };
  const items = list.value || [];
  const allFiles = items.filter(
    (i): i is { id: string; name: string; file: unknown } => !!i.file && !!i.id && !!i.name
  );
  const files = filterSyncItems(allFiles, config);
  let synced = 0;
  for (const file of files) {
    if (!file.id || !file.name) continue;
    const downRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${file.id}/content`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!downRes.ok) continue;
    const buffer = Buffer.from(await downRes.arrayBuffer());
    const docId = crypto.randomUUID();
    const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storePath = `connectors/${connectorId}/${file.id}_${sanitized}`;
    const localStorePath = `uploads/${docId}_${sanitized}`;
    const finalPath = await writeToStore(
      useS3,
      store,
      storePath,
      localStorePath,
      buffer,
      "application/octet-stream",
      collectionId
    );
    await db
      .insert(ragDocuments)
      .values({
        id: docId,
        collectionId,
        externalId: file.id,
        storePath: finalPath,
        mimeType: "application/octet-stream",
        metadata: JSON.stringify({ source: "onedrive", name: file.name }),
        createdAt: Date.now(),
      })
      .run();
    synced++;
  }
  return { synced, total: files.length };
}

export async function syncNotion(
  config: Record<string, unknown>,
  connectorId: string,
  collectionId: string,
  store: StoreRow,
  useS3: boolean
): Promise<{ synced: number; total: number }> {
  const token = getToken(config, "accessTokenRef");
  const searchRes = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ page_size: 50 }),
  });
  if (!searchRes.ok) throw new Error(`Notion search failed: ${searchRes.status}`);
  const search = (await searchRes.json()) as { results?: { id: string }[] };
  const allPages = search.results || [];
  const pages = filterSyncItems(
    allPages.map((p) => ({ id: p.id, name: p.id })),
    config
  );
  let synced = 0;
  for (const page of pages) {
    const blockRes = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
      },
    });
    if (!blockRes.ok) continue;
    const blockData = (await blockRes.json()) as { results?: unknown[] };
    const text = JSON.stringify(blockData.results || []);
    const buffer = Buffer.from(text, "utf-8");
    const docId = crypto.randomUUID();
    const storePath = `connectors/${connectorId}/${page.id}.json`;
    const localStorePath = `uploads/${docId}_${page.id}.json`;
    const finalPath = await writeToStore(
      useS3,
      store,
      storePath,
      localStorePath,
      buffer,
      "application/json",
      collectionId
    );
    await db
      .insert(ragDocuments)
      .values({
        id: docId,
        collectionId,
        externalId: page.id,
        storePath: finalPath,
        mimeType: "application/json",
        metadata: JSON.stringify({ source: "notion", pageId: page.id }),
        createdAt: Date.now(),
      })
      .run();
    synced++;
  }
  return { synced, total: pages.length };
}

export async function syncConfluence(
  config: Record<string, unknown>,
  connectorId: string,
  collectionId: string,
  store: StoreRow,
  useS3: boolean
): Promise<{ synced: number; total: number }> {
  const baseUrl = (config.baseUrl as string)?.replace(/\/$/, "") || "";
  const token = getToken(config, "accessTokenRef");
  if (!baseUrl) throw new Error("Confluence config.baseUrl required");
  const listRes = await fetch(`${baseUrl}/rest/api/content?limit=50`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) throw new Error(`Confluence list failed: ${listRes.status}`);
  const list = (await listRes.json()) as { results?: { id: string; title?: string }[] };
  const allPages = list.results || [];
  const pages = filterSyncItems(
    allPages.map((p) => ({ id: p.id, name: p.title ?? p.id })),
    config
  );
  let synced = 0;
  for (const page of pages) {
    const pageRes = await fetch(`${baseUrl}/rest/api/content/${page.id}?expand=body.storage`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!pageRes.ok) continue;
    const pageData = (await pageRes.json()) as { body?: { storage?: { value?: string } } };
    const html = pageData.body?.storage?.value || "";
    const buffer = Buffer.from(html, "utf-8");
    const docId = crypto.randomUUID();
    const storePath = `connectors/${connectorId}/${page.id}.html`;
    const localStorePath = `uploads/${docId}_${page.id}.html`;
    const finalPath = await writeToStore(
      useS3,
      store,
      storePath,
      localStorePath,
      buffer,
      "text/html",
      collectionId
    );
    await db
      .insert(ragDocuments)
      .values({
        id: docId,
        collectionId,
        externalId: page.id,
        storePath: finalPath,
        mimeType: "text/html",
        metadata: JSON.stringify({ source: "confluence", title: page.name }),
        createdAt: Date.now(),
      })
      .run();
    synced++;
  }
  return { synced, total: pages.length };
}

export async function syncGitBook(
  config: Record<string, unknown>,
  connectorId: string,
  collectionId: string,
  store: StoreRow,
  useS3: boolean
): Promise<{ synced: number; total: number }> {
  const token = getToken(config, "accessTokenRef");
  const listRes = await fetch("https://api.gitbook.com/v1/spaces", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) throw new Error(`GitBook spaces failed: ${listRes.status}`);
  const list = (await listRes.json()) as { items?: { uid: string; title?: string }[] };
  const allSpaces = list.items || [];
  const spaces = filterSyncItems(
    allSpaces.map((s) => ({ id: s.uid, name: s.title ?? s.uid })),
    config
  );
  let synced = 0;
  for (const space of spaces) {
    const contentRes = await fetch(`https://api.gitbook.com/v1/spaces/${space.id}/content`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!contentRes.ok) continue;
    const text = await contentRes.text();
    const buffer = Buffer.from(text, "utf-8");
    const docId = crypto.randomUUID();
    const storePath = `connectors/${connectorId}/${space.id}.json`;
    const localStorePath = `uploads/${docId}_${space.id}.json`;
    const finalPath = await writeToStore(
      useS3,
      store,
      storePath,
      localStorePath,
      buffer,
      "application/json",
      collectionId
    );
    await db
      .insert(ragDocuments)
      .values({
        id: docId,
        collectionId,
        externalId: space.id,
        storePath: finalPath,
        mimeType: "application/json",
        metadata: JSON.stringify({ source: "gitbook", title: space.name }),
        createdAt: Date.now(),
      })
      .run();
    synced++;
  }
  return { synced, total: spaces.length };
}

export async function syncBookStack(
  config: Record<string, unknown>,
  connectorId: string,
  collectionId: string,
  store: StoreRow,
  useS3: boolean
): Promise<{ synced: number; total: number }> {
  const baseUrl = (config.baseUrl as string)?.replace(/\/$/, "") || "";
  let tokenId = (config.tokenId as string | undefined)?.trim();
  let tokenSecret = (config.tokenSecret as string | undefined)?.trim();
  if (tokenId && process.env[tokenId]) tokenId = process.env[tokenId];
  if (tokenSecret && process.env[tokenSecret]) tokenSecret = process.env[tokenSecret];
  if (!baseUrl || !tokenId || !tokenSecret)
    throw new Error("BookStack config requires baseUrl, tokenId, tokenSecret");
  const auth = "Basic " + Buffer.from(`${tokenId}:${tokenSecret}`, "utf-8").toString("base64");
  const booksRes = await fetch(`${baseUrl}/api/books`, {
    headers: { Authorization: auth },
  });
  if (!booksRes.ok) throw new Error(`BookStack books failed: ${booksRes.status}`);
  const books = (await booksRes.json()) as { data?: { id: number }[] };
  const bookList = books.data || [];
  let synced = 0;
  for (const book of bookList) {
    const pagesRes = await fetch(`${baseUrl}/api/books/${book.id}/pages`, {
      headers: { Authorization: auth },
    });
    if (!pagesRes.ok) continue;
    const pagesData = (await pagesRes.json()) as { data?: { id: number }[] };
    const pages = pagesData.data || [];
    for (const p of pages) {
      const pageRes = await fetch(`${baseUrl}/api/pages/${p.id}`, {
        headers: { Authorization: auth },
      });
      if (!pageRes.ok) continue;
      const page = (await pageRes.json()) as { html?: string; name?: string };
      const buffer = Buffer.from(page.html || "", "utf-8");
      const docId = crypto.randomUUID();
      const storePath = `connectors/${connectorId}/page_${p.id}.html`;
      const localStorePath = `uploads/${docId}_page_${p.id}.html`;
      const finalPath = await writeToStore(
        useS3,
        store,
        storePath,
        localStorePath,
        buffer,
        "text/html",
        collectionId
      );
      await db
        .insert(ragDocuments)
        .values({
          id: docId,
          collectionId,
          externalId: String(p.id),
          storePath: finalPath,
          mimeType: "text/html",
          metadata: JSON.stringify({ source: "bookstack", name: page.name }),
          createdAt: Date.now(),
        })
        .run();
      synced++;
    }
  }
  return { synced, total: synced };
}
