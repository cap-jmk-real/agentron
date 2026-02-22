/**
 * Connector type metadata for RAG connectors (Knowledge → Connectors).
 * syncImplemented must match the sync route: only types with a handler in
 * api/rag/connectors/[id]/sync/route.ts are true.
 */
export const CONNECTOR_TYPES_SYNC_IMPLEMENTED = new Set([
  "google_drive",
  "filesystem",
  "obsidian_vault",
  "logseq_graph",
  "dropbox",
  "onedrive",
  "notion",
  "confluence",
  "gitbook",
  "bookstack",
]);

export type ConnectorTypeId =
  | "google_drive"
  | "dropbox"
  | "onedrive"
  | "notion"
  | "confluence"
  | "gitbook"
  | "bookstack"
  | "obsidian_vault"
  | "logseq_graph"
  | "roam"
  | "filesystem"
  | "github"
  | "gitlab"
  | "jira"
  | "linear"
  | "slack"
  | "discord"
  | "readwise"
  | "coda";

export type ConnectorTypeMeta = {
  id: ConnectorTypeId;
  label: string;
  logoPath: string;
  description: string;
  syncImplemented: boolean;
};

const BASE = "/connectors";

export const CONNECTOR_TYPES: ConnectorTypeMeta[] = [
  {
    id: "google_drive",
    label: "Google Drive",
    logoPath: `${BASE}/google-drive.svg`,
    description: "Sync files from Google Drive",
    syncImplemented: true,
  },
  {
    id: "dropbox",
    label: "Dropbox",
    logoPath: `${BASE}/dropbox.svg`,
    description: "Sync files from Dropbox",
    syncImplemented: true,
  },
  {
    id: "onedrive",
    label: "OneDrive",
    logoPath: `${BASE}/onedrive.svg`,
    description: "Sync files from OneDrive / SharePoint",
    syncImplemented: true,
  },
  {
    id: "notion",
    label: "Notion",
    logoPath: `${BASE}/notion.svg`,
    description: "Sync pages and databases from Notion",
    syncImplemented: true,
  },
  {
    id: "confluence",
    label: "Confluence",
    logoPath: `${BASE}/confluence.svg`,
    description: "Sync spaces and pages from Confluence",
    syncImplemented: true,
  },
  {
    id: "gitbook",
    label: "GitBook",
    logoPath: `${BASE}/gitbook.svg`,
    description: "Sync documentation from GitBook",
    syncImplemented: true,
  },
  {
    id: "bookstack",
    label: "BookStack",
    logoPath: `${BASE}/bookstack.svg`,
    description: "Sync books and pages from BookStack wiki",
    syncImplemented: true,
  },
  {
    id: "obsidian_vault",
    label: "Obsidian",
    logoPath: `${BASE}/obsidian.svg`,
    description: "Sync from a local Obsidian vault path",
    syncImplemented: true,
  },
  {
    id: "logseq_graph",
    label: "LogSeq",
    logoPath: `${BASE}/logseq.svg`,
    description: "Sync from a local LogSeq graph path",
    syncImplemented: true,
  },
  {
    id: "filesystem",
    label: "Local folder",
    logoPath: `${BASE}/filesystem.svg`,
    description: "Sync from a local folder path",
    syncImplemented: true,
  },
  {
    id: "roam",
    label: "Roam Research",
    logoPath: `${BASE}/roam.svg`,
    description: "Sync from Roam Research (coming later)",
    syncImplemented: false,
  },
  {
    id: "github",
    label: "GitHub",
    logoPath: `${BASE}/github.svg`,
    description: "Sync repo docs / wiki (optional)",
    syncImplemented: false,
  },
  {
    id: "gitlab",
    label: "GitLab",
    logoPath: `${BASE}/gitlab.svg`,
    description: "Sync repo docs (optional)",
    syncImplemented: false,
  },
  {
    id: "jira",
    label: "Jira",
    logoPath: `${BASE}/jira.svg`,
    description: "Sync issue descriptions (optional)",
    syncImplemented: false,
  },
  {
    id: "linear",
    label: "Linear",
    logoPath: `${BASE}/linear.svg`,
    description: "Sync issues (optional)",
    syncImplemented: false,
  },
  {
    id: "slack",
    label: "Slack",
    logoPath: `${BASE}/slack.svg`,
    description: "Sync channel history (optional)",
    syncImplemented: false,
  },
  {
    id: "discord",
    label: "Discord",
    logoPath: `${BASE}/discord.svg`,
    description: "Sync server/channel content (optional)",
    syncImplemented: false,
  },
  {
    id: "readwise",
    label: "Readwise",
    logoPath: `${BASE}/readwise.svg`,
    description: "Sync highlights (optional)",
    syncImplemented: false,
  },
  {
    id: "coda",
    label: "Coda",
    logoPath: `${BASE}/coda.svg`,
    description: "Sync docs (optional)",
    syncImplemented: false,
  },
];

export function getConnectorTypeMeta(typeId: string): ConnectorTypeMeta | undefined {
  return CONNECTOR_TYPES.find((t) => t.id === typeId);
}

export function getConnectorTypesWithSync(): ConnectorTypeMeta[] {
  return CONNECTOR_TYPES.filter((t) => t.syncImplemented);
}

export function getConnectorTypesForPicker(): ConnectorTypeMeta[] {
  return CONNECTOR_TYPES.filter((t) => t.syncImplemented);
}
