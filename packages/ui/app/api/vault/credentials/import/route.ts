import { json } from "../../../_lib/response";
import { getVaultKeyFromRequest } from "../../../_lib/vault";
import { setStoredCredential, normalizeCredentialKey } from "../../../_lib/credential-store";

export const runtime = "nodejs";

type ImportEntry = { key: string; value: string };

function parseCsv(text: string): ImportEntry[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const rows: string[][] = [];
  for (const line of lines) {
    const cells: string[] = [];
    let rest = line;
    while (rest.length > 0) {
      if (rest.startsWith('"')) {
        let end = 1;
        while (end < rest.length) {
          const next = rest.indexOf('"', end);
          if (next === -1) {
            end = rest.length;
            break;
          }
          if (rest[next + 1] === '"') {
            end = next + 2;
            continue;
          }
          end = next;
          break;
        }
        cells.push(rest.slice(1, end).replace(/""/g, '"'));
        rest = rest.slice(end + 1).replace(/^\s*,\s*/, "");
      } else {
        const comma = rest.indexOf(",");
        if (comma === -1) {
          cells.push(rest.trim());
          rest = "";
        } else {
          cells.push(rest.slice(0, comma).trim());
          rest = rest.slice(comma + 1).trim();
        }
      }
    }
    rows.push(cells);
  }
  const entries: ImportEntry[] = [];
  const isHeader = (row: string[]) => {
    if (row.length < 2) return false;
    const first = (row[0] ?? "").toLowerCase();
    const second = (row[1] ?? "").toLowerCase();
    return (
      (first === "key" && second === "value") ||
      (first === "name" && second === "password") ||
      (first === "service" && (second === "password" || second === "value")) ||
      first === "label" ||
      first === "username"
    );
  };
  let start = 0;
  if (rows[0] && isHeader(rows[0])) start = 1;
  for (let i = start; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (row.length < 2) continue;
    const key = (row[0] ?? "").trim();
    const value = (row[row.length - 1] ?? "").trim();
    if (key && value) entries.push({ key, value });
  }
  return entries;
}

/** POST /api/vault/credentials/import — import from JSON body or CSV file. Requires vault unlocked. */
export async function POST(request: Request) {
  const vaultKey = getVaultKeyFromRequest(request);
  if (!vaultKey) {
    return json({ error: "Vault is locked. Unlock the vault first." }, { status: 403 });
  }
  const contentType = request.headers.get("content-type") ?? "";
  let entries: ImportEntry[] = [];
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file") ?? form.get("csv");
    if (!file || !(file instanceof File)) {
      return json({ error: "No file provided. Use form field 'file' or 'csv'." }, { status: 400 });
    }
    const text = await file.text();
    const ext = (file.name ?? "").toLowerCase();
    if (ext.endsWith(".csv")) {
      entries = parseCsv(text);
    } else if (ext.endsWith(".json")) {
      try {
        const data = (await JSON.parse(text)) as { entries?: ImportEntry[]; keys?: string[] };
        if (Array.isArray(data.entries)) entries = data.entries;
        else if (Array.isArray(data.keys)) entries = data.keys.map((k) => ({ key: k, value: "" }));
      } catch {
        return json({ error: "Invalid JSON file." }, { status: 400 });
      }
    } else {
      entries = parseCsv(text);
    }
  } else if (contentType.includes("application/json")) {
    const body = (await request.json()) as { entries?: ImportEntry[] };
    entries = Array.isArray(body.entries) ? body.entries : [];
  } else {
    return json(
      { error: "Send JSON { entries: [{ key, value }] } or multipart/form-data with a CSV file." },
      { status: 400 }
    );
  }
  let imported = 0;
  const errors: string[] = [];
  for (const { key, value } of entries) {
    const k = key.trim();
    if (!k) continue;
    if (!value.trim()) {
      errors.push(`Skipped "${k}": empty value`);
      continue;
    }
    const norm = normalizeCredentialKey(k);
    try {
      await setStoredCredential(norm, value.trim(), true, vaultKey);
      imported++;
    } catch (e) {
      errors.push(`${k}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  return json({
    ok: true,
    imported,
    total: entries.length,
    errors: errors.length ? errors : undefined,
  });
}
