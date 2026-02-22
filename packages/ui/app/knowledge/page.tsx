"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Database,
  Settings,
  FolderOpen,
  Box,
  Cloud,
  ListFilter,
  CheckSquare,
  Square,
} from "lucide-react";
import ConfirmModal from "../components/confirm-modal";
import {
  getConnectorTypeMeta,
  getConnectorTypesForPicker,
  type ConnectorTypeId,
} from "./_lib/connector-types";

type EncodingConfig = {
  id: string;
  name: string;
  provider: string;
  modelOrEndpoint: string;
  dimensions: number;
  embeddingProviderId?: string;
  endpoint?: string;
  createdAt: number;
};

type EmbeddingProvider = {
  id: string;
  name: string;
  type: string;
  endpoint?: string;
  apiKeySet?: boolean;
  createdAt: number;
};

type DocumentStore = {
  id: string;
  name: string;
  type: string;
  bucket: string;
  region?: string;
  endpoint?: string;
  credentialsRef?: string;
  createdAt: number;
};

type VectorStore = {
  id: string;
  name: string;
  type: string;
  config?: Record<string, unknown>;
  createdAt: number;
};

type Collection = {
  id: string;
  name: string;
  scope: "deployment" | "agent";
  agentId?: string;
  encodingConfigId: string;
  documentStoreId: string;
  vectorStoreId?: string;
  createdAt: number;
};

type Connector = {
  id: string;
  type: string;
  collectionId: string;
  config: Record<string, unknown>;
  status: string;
  lastSyncAt?: number;
  lastError?: string;
  createdAt: number;
};

type TabId = "encoding" | "stores" | "vectorstores" | "collections" | "connectors";

type DocItem = {
  id: string;
  storePath: string;
  metadata?: { originalName?: string };
  createdAt: number;
};

type BrowseItem = { id: string; name: string; type?: string; path?: string };

const TEXT_BASED_CONNECTOR_TYPES = new Set([
  "notion",
  "obsidian_vault",
  "logseq_graph",
  "confluence",
  "gitbook",
  "bookstack",
]);

function StudioDocumentsList({
  collectionId,
  onIngest,
}: {
  collectionId: string;
  onIngest: () => void;
}) {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [ingestingId, setIngestingId] = useState<string | null>(null);
  const [ingestAllStatus, setIngestAllStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  useEffect(() => {
    fetch(`/api/rag/documents?collectionId=${encodeURIComponent(collectionId)}`)
      .then((r) => r.json())
      .then((d) => setDocs(Array.isArray(d) ? d : []))
      .catch(() => setDocs([]));
  }, [collectionId]);
  const runIngest = async (documentId: string) => {
    setIngestAllStatus(null);
    setIngestingId(documentId);
    try {
      const res = await fetch("/api/rag/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setIngestAllStatus({
          type: "success",
          message: `Ingested ${data.chunks ?? 0} chunks.`,
        });
      } else {
        setIngestAllStatus({ type: "error", message: data?.error || "Ingest failed" });
      }
      onIngest();
    } finally {
      setIngestingId(null);
    }
  };
  const runIngestAll = async () => {
    setIngestAllStatus(null);
    setIngestingId("all");
    try {
      const res = await fetch("/api/rag/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setIngestAllStatus({
          type: "success",
          message: `Ingested ${data.documents ?? 0} documents, ${data.chunks ?? 0} chunks.`,
        });
      } else {
        setIngestAllStatus({ type: "error", message: data?.error || "Ingest all failed" });
      }
      onIngest();
    } finally {
      setIngestingId(null);
    }
  };
  if (docs.length === 0) return null;
  return (
    <div style={{ marginTop: "1rem" }}>
      <h4 style={{ margin: "0 0 0.35rem", fontSize: "0.9rem" }}>Documents (uploads + synced)</h4>
      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
        Connectors that sync to this collection appear here. Ingest makes them searchable in chat.
      </p>
      {ingestAllStatus && (
        <p
          style={{
            fontSize: "0.85rem",
            margin: "0 0 0.35rem",
            color: ingestAllStatus.type === "error" ? "var(--error)" : "var(--success)",
          }}
        >
          {ingestAllStatus.message}
        </p>
      )}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <button
          type="button"
          className="button button-small"
          onClick={runIngestAll}
          disabled={!!ingestingId}
        >
          {ingestingId === "all" ? "Ingesting all…" : "Ingest all"}
        </button>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "0.85rem" }}>
        {docs.map((d) => (
          <li
            key={d.id}
            style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.25rem 0" }}
          >
            <span style={{ flex: 1 }}>{d.metadata?.originalName ?? d.storePath}</span>
            <button
              type="button"
              className="button button-small"
              onClick={() => runIngest(d.id)}
              disabled={!!ingestingId}
            >
              {ingestingId === d.id ? "Ingesting…" : "Ingest"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function KnowledgePage() {
  const [activeTab, setActiveTab] = useState<TabId>("collections");
  const [encodingConfigs, setEncodingConfigs] = useState<EncodingConfig[]>([]);
  const [embeddingProviders, setEmbeddingProviders] = useState<EmbeddingProvider[]>([]);
  const [stores, setStores] = useState<DocumentStore[]>([]);
  const [vectorStores, setVectorStores] = useState<VectorStore[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEncodingForm, setShowEncodingForm] = useState(false);
  const [showStoreForm, setShowStoreForm] = useState(false);
  const [showVectorStoreForm, setShowVectorStoreForm] = useState(false);
  const [showCollectionForm, setShowCollectionForm] = useState(false);
  const [showConnectorForm, setShowConnectorForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: TabId;
    id: string;
    name: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [syncingConnectorId, setSyncingConnectorId] = useState<string | null>(null);
  const [connectorForItems, setConnectorForItems] = useState<Connector | null>(null);
  const [browseItems, setBrowseItems] = useState<BrowseItem[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseNextToken, setBrowseNextToken] = useState<string | undefined>(undefined);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [savingSelection, setSavingSelection] = useState(false);

  // Encoding form
  const [encName, setEncName] = useState("");
  const [encEmbeddingProviderId, setEncEmbeddingProviderId] = useState("");
  const [encProvider, setEncProvider] = useState("openai");
  const [encModel, setEncModel] = useState("text-embedding-3-small");
  const [encDimensions, setEncDimensions] = useState("1536");
  const [encLocalModels, setEncLocalModels] = useState<{ name: string; dimensions?: number }[]>([]);
  const [savingEnc, setSavingEnc] = useState(false);

  // Store form
  const [storeName, setStoreName] = useState("");
  const [storeType, setStoreType] = useState<"s3" | "minio" | "gcs">("s3");
  const [storeBucket, setStoreBucket] = useState("");
  const [storeRegion, setStoreRegion] = useState("");
  const [storeEndpoint, setStoreEndpoint] = useState("");
  const [storeCredentialsRef, setStoreCredentialsRef] = useState("");
  const [savingStore, setSavingStore] = useState(false);

  // Collection form
  const [collName, setCollName] = useState("");
  const [collScope, setCollScope] = useState<"deployment" | "agent">("deployment");
  const [collEncodingId, setCollEncodingId] = useState("");
  const [collStoreId, setCollStoreId] = useState("");
  const [collVectorStoreId, setCollVectorStoreId] = useState<string>("");
  const [savingColl, setSavingColl] = useState(false);

  const [vecStoreName, setVecStoreName] = useState("");
  const [vecStoreType, setVecStoreType] = useState<"bundled" | "qdrant" | "pinecone" | "pgvector">(
    "bundled"
  );
  const [savingVecStore, setSavingVecStore] = useState(false);

  const [connectorType, setConnectorType] = useState<ConnectorTypeId | "">("google_drive");
  const [connectorCollectionId, setConnectorCollectionId] = useState("");
  const [connectorFolderId, setConnectorFolderId] = useState("root");
  const [connectorServiceAccountKeyRef, setConnectorServiceAccountKeyRef] = useState("");
  const [connectorPath, setConnectorPath] = useState("");
  const [connectorIngestAfterSync, setConnectorIngestAfterSync] = useState(true);
  const [connectorAccessTokenRef, setConnectorAccessTokenRef] = useState("");
  const [connectorBaseUrl, setConnectorBaseUrl] = useState("");
  const [connectorTokenId, setConnectorTokenId] = useState("");
  const [connectorTokenSecret, setConnectorTokenSecret] = useState("");
  const [savingConnector, setSavingConnector] = useState(false);

  const loadAll = useCallback(async () => {
    const [encRes, provRes, storeRes, vecRes, collRes, connRes] = await Promise.all([
      fetch("/api/rag/encoding-config"),
      fetch("/api/rag/embedding-providers"),
      fetch("/api/rag/document-store"),
      fetch("/api/rag/vector-store"),
      fetch("/api/rag/collections"),
      fetch("/api/rag/connectors"),
    ]);
    const enc = await encRes.json();
    const prov = await provRes.json();
    const st = await storeRes.json();
    const vec = await vecRes.json();
    const coll = await collRes.json();
    const conn = await connRes.json();
    setEncodingConfigs(Array.isArray(enc) ? enc : []);
    setEmbeddingProviders(Array.isArray(prov) ? prov : []);
    setStores(Array.isArray(st) ? st : []);
    setVectorStores(Array.isArray(vec) ? vec : []);
    setCollections(Array.isArray(coll) ? coll : []);
    setConnectors(Array.isArray(conn) ? conn : []);
  }, []);

  useEffect(() => {
    setLoading(true);
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  const openSelectItems = (c: Connector) => {
    setConnectorForItems(c);
    const includeIds = c.config?.includeIds;
    setSelectedItemIds(
      new Set(
        Array.isArray(includeIds)
          ? includeIds.filter((x): x is string => typeof x === "string")
          : []
      )
    );
    setBrowseItems([]);
    setBrowseNextToken(undefined);
  };

  useEffect(() => {
    if (!connectorForItems) return;
    setBrowseLoading(true);
    fetch(`/api/rag/connectors/${connectorForItems.id}/items?limit=200`)
      .then((r) => r.json())
      .then((d: { items?: BrowseItem[]; nextPageToken?: string; error?: string }) => {
        if (d.error) {
          setBrowseItems([]);
          return;
        }
        setBrowseItems(d.items || []);
        setBrowseNextToken(d.nextPageToken);
      })
      .catch(() => setBrowseItems([]))
      .finally(() => setBrowseLoading(false));
  }, [connectorForItems?.id]);

  const runSyncAll = async () => {
    if (!connectorForItems) return;
    setSavingSelection(true);
    try {
      const nextConfig = { ...connectorForItems.config };
      delete nextConfig.includeIds;
      await fetch(`/api/rag/connectors/${connectorForItems.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: nextConfig }),
      });
      setConnectorForItems(null);
      await loadAll();
    } finally {
      setSavingSelection(false);
    }
  };

  const runSaveSelection = async () => {
    if (!connectorForItems) return;
    setSavingSelection(true);
    try {
      const nextConfig = {
        ...connectorForItems.config,
        includeIds: Array.from(selectedItemIds),
      };
      await fetch(`/api/rag/connectors/${connectorForItems.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: nextConfig }),
      });
      setConnectorForItems(null);
      await loadAll();
    } finally {
      setSavingSelection(false);
    }
  };

  const toggleItemId = (id: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllBrowse = () => {
    setSelectedItemIds(new Set(browseItems.map((i) => i.id)));
  };
  const deselectAllBrowse = () => {
    setSelectedItemIds(new Set());
  };

  const loadMoreBrowse = () => {
    if (!connectorForItems || !browseNextToken) return;
    setBrowseLoading(true);
    fetch(
      `/api/rag/connectors/${connectorForItems.id}/items?limit=200&pageToken=${encodeURIComponent(browseNextToken)}`
    )
      .then((r) => r.json())
      .then((d: { items?: BrowseItem[]; nextPageToken?: string; error?: string }) => {
        if (d.error) return;
        setBrowseItems((prev) => [...prev, ...(d.items || [])]);
        setBrowseNextToken(d.nextPageToken);
      })
      .finally(() => setBrowseLoading(false));
  };

  const selectedEncProvider = embeddingProviders.find((p) => p.id === encEmbeddingProviderId);
  useEffect(() => {
    if (!encEmbeddingProviderId || selectedEncProvider?.type !== "local") {
      setEncLocalModels([]);
      return;
    }
    fetch(`/api/rag/embedding-providers/${encodeURIComponent(encEmbeddingProviderId)}/models`)
      .then((r) => r.json())
      .then((d: { models?: { name: string; dimensions?: number }[] }) =>
        setEncLocalModels(Array.isArray(d?.models) ? d.models : [])
      )
      .catch(() => setEncLocalModels([]));
  }, [encEmbeddingProviderId, selectedEncProvider?.type]);

  const createEncoding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!encName.trim()) return;
    setSavingEnc(true);
    try {
      const dimensions = parseInt(encDimensions, 10) || 1536;
      if (encEmbeddingProviderId) {
        await fetch("/api/rag/encoding-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: encName.trim(),
            embeddingProviderId: encEmbeddingProviderId,
            modelOrEndpoint: encModel.trim() || "nomic-embed-text",
            dimensions,
          }),
        });
      } else {
        await fetch("/api/rag/encoding-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: encName.trim(),
            provider: encProvider,
            modelOrEndpoint: encModel,
            dimensions,
          }),
        });
      }
      await loadAll();
      setEncName("");
      setEncEmbeddingProviderId("");
      setEncModel("text-embedding-3-small");
      setEncDimensions("1536");
      setShowEncodingForm(false);
    } finally {
      setSavingEnc(false);
    }
  };

  const createStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeName.trim() || !storeBucket.trim()) return;
    setSavingStore(true);
    try {
      await fetch("/api/rag/document-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: storeName.trim(),
          type: storeType,
          bucket: storeBucket.trim(),
          region: storeRegion.trim() || undefined,
          endpoint: storeEndpoint.trim() || undefined,
          credentialsRef: storeCredentialsRef.trim() || undefined,
        }),
      });
      await loadAll();
      setStoreName("");
      setStoreBucket("");
      setStoreRegion("");
      setStoreEndpoint("");
      setStoreCredentialsRef("");
      setShowStoreForm(false);
    } finally {
      setSavingStore(false);
    }
  };

  const buildConnectorConfig = (): Record<string, unknown> => {
    let base: Record<string, unknown> = {};
    if (connectorType === "google_drive") {
      base = {
        folderId: connectorFolderId || "root",
        serviceAccountKeyRef: connectorServiceAccountKeyRef || undefined,
      };
    } else if (
      connectorType === "filesystem" ||
      connectorType === "obsidian_vault" ||
      connectorType === "logseq_graph"
    ) {
      base = { path: connectorPath || undefined };
    } else if (connectorType === "dropbox") {
      base = {
        path: connectorPath || "",
        accessTokenRef: connectorAccessTokenRef || undefined,
      };
    } else if (
      connectorType === "onedrive" ||
      connectorType === "notion" ||
      connectorType === "gitbook"
    ) {
      base = { accessTokenRef: connectorAccessTokenRef || undefined };
    } else if (connectorType === "confluence") {
      base = {
        baseUrl: connectorBaseUrl || undefined,
        accessTokenRef: connectorAccessTokenRef || undefined,
      };
    } else if (connectorType === "bookstack") {
      base = {
        baseUrl: connectorBaseUrl || undefined,
        tokenId: connectorTokenId || undefined,
        tokenSecret: connectorTokenSecret || undefined,
      };
    }
    return { ...base, ingestAfterSync: connectorIngestAfterSync };
  };

  const createConnector = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectorCollectionId || !connectorType) return;
    setSavingConnector(true);
    try {
      await fetch("/api/rag/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: connectorType,
          collectionId: connectorCollectionId,
          config: buildConnectorConfig(),
        }),
      });
      await loadAll();
      setConnectorCollectionId("");
      setConnectorFolderId("root");
      setConnectorServiceAccountKeyRef("");
      setConnectorPath("");
      setConnectorAccessTokenRef("");
      setConnectorBaseUrl("");
      setConnectorTokenId("");
      setConnectorTokenSecret("");
      setShowConnectorForm(false);
    } finally {
      setSavingConnector(false);
    }
  };

  const runConnectorSync = async (connectorId: string) => {
    setSyncingConnectorId(connectorId);
    try {
      const res = await fetch(`/api/rag/connectors/${connectorId}/sync`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) alert(`Synced ${data.synced ?? 0} files.`);
      else alert(data?.error || "Sync failed");
      await loadAll();
    } finally {
      setSyncingConnectorId(null);
    }
  };

  const createVectorStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vecStoreName.trim()) return;
    setSavingVecStore(true);
    try {
      await fetch("/api/rag/vector-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: vecStoreName.trim(),
          type: vecStoreType,
          config: vecStoreType === "bundled" ? undefined : {},
        }),
      });
      await loadAll();
      setVecStoreName("");
      setShowVectorStoreForm(false);
    } finally {
      setSavingVecStore(false);
    }
  };

  const createCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collName.trim() || !collEncodingId || !collStoreId) return;
    setSavingColl(true);
    try {
      await fetch("/api/rag/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: collName.trim(),
          scope: collScope,
          encodingConfigId: collEncodingId,
          documentStoreId: collStoreId,
          vectorStoreId: collVectorStoreId || null,
        }),
      });
      await loadAll();
      setCollName("");
      setCollEncodingId("");
      setCollStoreId("");
      setCollVectorStoreId("");
      setShowCollectionForm(false);
    } finally {
      setSavingColl(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const base = "/api/rag";
      const url =
        deleteTarget.type === "encoding"
          ? `${base}/encoding-config/${deleteTarget.id}`
          : deleteTarget.type === "stores"
            ? `${base}/document-store/${deleteTarget.id}`
            : deleteTarget.type === "vectorstores"
              ? `${base}/vector-store/${deleteTarget.id}`
              : deleteTarget.type === "connectors"
                ? `${base}/connectors/${deleteTarget.id}`
                : `${base}/collections/${deleteTarget.id}`;
      await fetch(url, { method: "DELETE" });
      await loadAll();
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "collections", label: "Collections", icon: <FolderOpen size={16} /> },
    { id: "connectors", label: "Connectors", icon: <Cloud size={16} /> },
    { id: "vectorstores", label: "Vector stores", icon: <Box size={16} /> },
    { id: "stores", label: "Document stores", icon: <Database size={16} /> },
    { id: "encoding", label: "Embedding model", icon: <Settings size={16} /> },
  ];

  const studioCollection = collections.find((c) => c.scope === "deployment");

  return (
    <div>
      <div style={{ marginBottom: "1rem" }}>
        <Link
          href="/"
          className="back-link"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
            marginBottom: "0.5rem",
          }}
        >
          <ArrowLeft size={14} /> Overview
        </Link>
        <h1 style={{ margin: 0, fontSize: "1.35rem" }}>Knowledge (RAG)</h1>
        <p style={{ margin: "0.35rem 0 0", fontSize: "0.9rem", color: "var(--text-muted)" }}>
          Studio knowledge powers the chat assistant. Create a <strong>deployment</strong>{" "}
          collection to give the chat context. Agents can use that or a custom collection.
        </p>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            borderBottom: "1px solid var(--border)",
            paddingBottom: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={"button" + (activeTab === t.id ? " button-primary" : "")}
              onClick={() => setActiveTab(t.id)}
              style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p style={{ color: "var(--text-muted)" }}>Loading...</p>
        ) : (
          <>
            {activeTab === "encoding" && (
              <section>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.75rem",
                  }}
                >
                  <h2 style={{ margin: 0, fontSize: "1rem" }}>Embedding model</h2>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setShowEncodingForm(!showEncodingForm)}
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
                {showEncodingForm && (
                  <form
                    onSubmit={createEncoding}
                    className="form"
                    style={{
                      marginBottom: "1rem",
                      padding: "1rem",
                      background: "var(--bg-subtle)",
                      borderRadius: "var(--radius)",
                    }}
                  >
                    <div className="field">
                      <label>Name</label>
                      <input
                        className="input"
                        value={encName}
                        onChange={(e) => setEncName(e.target.value)}
                        placeholder="e.g. OpenAI embeddings"
                      />
                    </div>
                    <div className="field">
                      <label>Embedding provider</label>
                      <select
                        className="select"
                        value={encEmbeddingProviderId}
                        onChange={(e) => {
                          setEncEmbeddingProviderId(e.target.value);
                          if (e.target.value) setEncModel("nomic-embed-text");
                          else setEncModel("text-embedding-3-small");
                        }}
                      >
                        <option value="">Legacy / custom (provider + model below)</option>
                        {embeddingProviders.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.type})
                          </option>
                        ))}
                      </select>
                    </div>
                    {!encEmbeddingProviderId && (
                      <div
                        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}
                      >
                        <div className="field">
                          <label>Provider</label>
                          <input
                            className="input"
                            value={encProvider}
                            onChange={(e) => setEncProvider(e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label>Model / endpoint</label>
                          <input
                            className="input"
                            value={encModel}
                            onChange={(e) => setEncModel(e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                    {encEmbeddingProviderId && (
                      <div className="field">
                        <label>Model</label>
                        {selectedEncProvider?.type === "local" && encLocalModels.length > 0 ? (
                          <select
                            className="select"
                            value={encModel}
                            onChange={(e) => {
                              const name = e.target.value;
                              setEncModel(name);
                              const model = encLocalModels.find((m) => m.name === name);
                              if (model?.dimensions != null)
                                setEncDimensions(String(model.dimensions));
                            }}
                          >
                            {encLocalModels.map((m) => (
                              <option key={m.name} value={m.name}>
                                {m.dimensions != null ? `${m.name} (${m.dimensions}d)` : m.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="input"
                            value={encModel}
                            onChange={(e) => setEncModel(e.target.value)}
                            placeholder={
                              selectedEncProvider?.type === "local"
                                ? "e.g. nomic-embed-text"
                                : "e.g. text-embedding-3-small"
                            }
                          />
                        )}
                      </div>
                    )}
                    <div className="field">
                      <label>Dimensions</label>
                      <input
                        className="input"
                        type="number"
                        value={encDimensions}
                        onChange={(e) => setEncDimensions(e.target.value)}
                      />
                    </div>
                    <button type="submit" className="button button-primary" disabled={savingEnc}>
                      {savingEnc ? "Saving..." : "Create"}
                    </button>
                  </form>
                )}
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {encodingConfigs.map((e) => {
                    const provName =
                      e.embeddingProviderId &&
                      embeddingProviders.find((p) => p.id === e.embeddingProviderId)?.name;
                    return (
                      <li
                        key={e.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "0.5rem 0",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        <span>
                          <strong>{e.name}</strong> —{" "}
                          {provName
                            ? `${provName} / ${e.modelOrEndpoint}`
                            : `${e.provider} / ${e.modelOrEndpoint}`}{" "}
                          ({e.dimensions}d)
                        </span>
                        <button
                          type="button"
                          className="button button-danger"
                          style={{ padding: "0.25rem 0.5rem" }}
                          onClick={() =>
                            setDeleteTarget({ type: "encoding", id: e.id, name: e.name })
                          }
                        >
                          <Trash2 size={12} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginTop: "0.5rem" }}>
                  Configure embedding endpoints in Settings → Embedding, then choose one here and
                  select the model. Embedding size depends on the model; selecting a model may set
                  dimensions—you can change them if needed. Used to vectorize documents and queries
                  for RAG. See the docs for a table of common model names and dimensions.
                </p>
                {embeddingProviders.length === 0 && (
                  <p
                    style={{
                      color: "var(--text-muted)",
                      fontSize: "0.82rem",
                      marginTop: "0.25rem",
                    }}
                  >
                    No embedding providers. Add one in Settings → Embedding, then create an encoding
                    config here.
                  </p>
                )}
                {encodingConfigs.length === 0 && !showEncodingForm && (
                  <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                    No encoding configs. Add one to use with collections.
                  </p>
                )}
              </section>
            )}

            {activeTab === "connectors" && (
              <section>
                <div className="section-header">
                  <h2 style={{ margin: 0, fontSize: "1rem" }}>Connectors</h2>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setShowConnectorForm(!showConnectorForm)}
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
                <p className="section-desc">
                  Sync external sources (Google Drive, Notion, local folders, etc.) into a
                  collection&apos;s document store. Synced files appear as documents; run Ingest on
                  them to add to the vector store.
                </p>
                {showConnectorForm && (
                  <form
                    onSubmit={createConnector}
                    className="form connector-form"
                    style={{
                      marginBottom: "1rem",
                      padding: "1rem",
                      background: "var(--bg-subtle)",
                      borderRadius: "var(--radius)",
                    }}
                  >
                    <div className="field">
                      <label>Connection type</label>
                      <div className="connector-picker-grid">
                        {getConnectorTypesForPicker().map((meta) => (
                          <button
                            key={meta.id}
                            type="button"
                            className="connector-picker-card"
                            onClick={() => setConnectorType(meta.id)}
                            style={{
                              borderColor: connectorType === meta.id ? "var(--primary)" : undefined,
                            }}
                          >
                            <img
                              src={meta.logoPath}
                              alt=""
                              className="connector-picker-logo"
                              onError={(e) => {
                                e.currentTarget.src = "/connectors/placeholder.svg";
                              }}
                            />
                            <span>{meta.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="field">
                      <label>Collection</label>
                      <select
                        className="select"
                        value={connectorCollectionId}
                        onChange={(e) => setConnectorCollectionId(e.target.value)}
                        required
                      >
                        <option value="">Select...</option>
                        {collections.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div
                      className="field"
                      style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
                    >
                      <input
                        type="checkbox"
                        id="connector-ingest-after-sync"
                        checked={connectorIngestAfterSync}
                        onChange={(e) => setConnectorIngestAfterSync(e.target.checked)}
                      />
                      <label htmlFor="connector-ingest-after-sync" style={{ margin: 0 }}>
                        Ingest after sync (chunk and embed new documents after each sync)
                      </label>
                    </div>
                    {connectorType === "google_drive" && (
                      <>
                        <div className="field">
                          <label>Folder ID (optional)</label>
                          <input
                            className="input"
                            value={connectorFolderId}
                            onChange={(e) => setConnectorFolderId(e.target.value)}
                            placeholder="root or Google Drive folder ID"
                          />
                        </div>
                        <div className="field">
                          <label>Service account key (env var name)</label>
                          <input
                            className="input"
                            value={connectorServiceAccountKeyRef}
                            onChange={(e) => setConnectorServiceAccountKeyRef(e.target.value)}
                            placeholder="GOOGLE_SERVICE_ACCOUNT_JSON"
                          />
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                            Env var containing the full service account JSON key.
                          </span>
                        </div>
                      </>
                    )}
                    {(connectorType === "filesystem" ||
                      connectorType === "obsidian_vault" ||
                      connectorType === "logseq_graph") && (
                      <div className="field">
                        <label>Path (absolute directory path)</label>
                        <input
                          className="input"
                          value={connectorPath}
                          onChange={(e) => setConnectorPath(e.target.value)}
                          placeholder="e.g. /path/to/vault or C:\vault"
                          required
                        />
                      </div>
                    )}
                    {(connectorType === "dropbox" ||
                      connectorType === "onedrive" ||
                      connectorType === "notion" ||
                      connectorType === "gitbook") && (
                      <div className="field">
                        <label>Access token (env var name)</label>
                        <input
                          className="input"
                          value={connectorAccessTokenRef}
                          onChange={(e) => setConnectorAccessTokenRef(e.target.value)}
                          placeholder="e.g. DROPBOX_TOKEN"
                          required={!!connectorType}
                        />
                      </div>
                    )}
                    {connectorType === "dropbox" && (
                      <div className="field">
                        <label>Folder path (optional)</label>
                        <input
                          className="input"
                          value={connectorPath}
                          onChange={(e) => setConnectorPath(e.target.value)}
                          placeholder="e.g. / or /Folder"
                        />
                      </div>
                    )}
                    {(connectorType === "confluence" || connectorType === "bookstack") && (
                      <div className="field">
                        <label>Base URL</label>
                        <input
                          className="input"
                          value={connectorBaseUrl}
                          onChange={(e) => setConnectorBaseUrl(e.target.value)}
                          placeholder="https://your-domain.atlassian.net/wiki or https://wiki.example.com"
                          required={connectorType === "confluence" || connectorType === "bookstack"}
                        />
                      </div>
                    )}
                    {connectorType === "confluence" && (
                      <div className="field">
                        <label>Access token (env var name)</label>
                        <input
                          className="input"
                          value={connectorAccessTokenRef}
                          onChange={(e) => setConnectorAccessTokenRef(e.target.value)}
                          placeholder="CONFLUENCE_TOKEN"
                          required
                        />
                      </div>
                    )}
                    {connectorType === "bookstack" && (
                      <>
                        <div className="field">
                          <label>Token ID (env var name or value)</label>
                          <input
                            className="input"
                            value={connectorTokenId}
                            onChange={(e) => setConnectorTokenId(e.target.value)}
                            placeholder="BOOKSTACK_TOKEN_ID"
                            required
                          />
                        </div>
                        <div className="field">
                          <label>Token secret (env var name or value)</label>
                          <input
                            className="input"
                            type="password"
                            value={connectorTokenSecret}
                            onChange={(e) => setConnectorTokenSecret(e.target.value)}
                            placeholder="BOOKSTACK_TOKEN_SECRET"
                            required
                          />
                        </div>
                      </>
                    )}
                    <button
                      type="submit"
                      className="button button-primary"
                      disabled={savingConnector}
                    >
                      {savingConnector ? "Saving..." : "Create"}
                    </button>
                  </form>
                )}
                <div className="connector-list">
                  {connectors.map((c) => {
                    const meta = getConnectorTypeMeta(c.type);
                    const label = meta?.label ?? c.type;
                    const logoPath = meta?.logoPath ?? "/connectors/placeholder.svg";
                    return (
                      <div key={c.id} className="connector-card">
                        <img
                          src={logoPath}
                          alt=""
                          className="connector-card-logo"
                          onError={(e) => {
                            e.currentTarget.src = "/connectors/placeholder.svg";
                          }}
                        />
                        <div className="connector-card-meta">
                          <strong>{label}</strong>
                          <span>
                            →{" "}
                            {collections.find((x) => x.id === c.collectionId)?.name ??
                              c.collectionId}{" "}
                            · {c.status}
                            {c.lastSyncAt
                              ? ` · last sync ${new Date(c.lastSyncAt).toLocaleString()}`
                              : ""}
                          </span>
                          {c.status === "error" && c.lastError && (
                            <span
                              style={{
                                display: "block",
                                fontSize: "0.8rem",
                                color: "var(--error)",
                                marginTop: "0.25rem",
                              }}
                            >
                              Last error: {c.lastError}
                            </span>
                          )}
                        </div>
                        <div className="connector-card-actions">
                          <button
                            type="button"
                            className="button button-small"
                            onClick={() => openSelectItems(c)}
                            title="Choose which items to sync"
                          >
                            <ListFilter size={12} /> Select items
                          </button>
                          <button
                            type="button"
                            className="button button-small"
                            onClick={() => runConnectorSync(c.id)}
                            disabled={!!syncingConnectorId}
                          >
                            {syncingConnectorId === c.id ? "Syncing…" : "Sync"}
                          </button>
                          <button
                            type="button"
                            className="button button-danger button-small"
                            onClick={() =>
                              setDeleteTarget({ type: "connectors", id: c.id, name: label })
                            }
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {connectors.length === 0 && !showConnectorForm && (
                  <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                    No connectors. Add one to sync Google Drive, Notion, local folders, or other
                    sources into a collection.
                  </p>
                )}
              </section>
            )}

            {activeTab === "vectorstores" && (
              <section>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.75rem",
                  }}
                >
                  <h2 style={{ margin: 0, fontSize: "1rem" }}>Vector stores</h2>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setShowVectorStoreForm(!showVectorStoreForm)}
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "var(--text-muted)",
                    marginBottom: "0.75rem",
                  }}
                >
                  Bundled stores vectors in the app database. Use an external store (Qdrant,
                  Pinecone, pgvector) for larger scale.
                </p>
                {showVectorStoreForm && (
                  <form
                    onSubmit={createVectorStore}
                    className="form"
                    style={{
                      marginBottom: "1rem",
                      padding: "1rem",
                      background: "var(--bg-subtle)",
                      borderRadius: "var(--radius)",
                    }}
                  >
                    <div className="field">
                      <label>Name</label>
                      <input
                        className="input"
                        value={vecStoreName}
                        onChange={(e) => setVecStoreName(e.target.value)}
                        placeholder="e.g. Bundled"
                      />
                    </div>
                    <div className="field">
                      <label>Type</label>
                      <select
                        className="select"
                        value={vecStoreType}
                        onChange={(e) =>
                          setVecStoreType(
                            e.target.value as "bundled" | "qdrant" | "pinecone" | "pgvector"
                          )
                        }
                      >
                        <option value="bundled">Bundled (in-app)</option>
                        <option value="qdrant">Qdrant</option>
                        <option value="pinecone">Pinecone</option>
                        <option value="pgvector">pgvector (Postgres)</option>
                      </select>
                    </div>
                    <button
                      type="submit"
                      className="button button-primary"
                      disabled={savingVecStore}
                    >
                      {savingVecStore ? "Saving..." : "Create"}
                    </button>
                  </form>
                )}
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {vectorStores.map((v) => (
                    <li
                      key={v.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "0.5rem 0",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <span>
                        <strong>{v.name}</strong> — {v.type}
                      </span>
                      <button
                        type="button"
                        className="button button-danger"
                        style={{ padding: "0.25rem 0.5rem" }}
                        onClick={() =>
                          setDeleteTarget({ type: "vectorstores", id: v.id, name: v.name })
                        }
                      >
                        <Trash2 size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
                {vectorStores.length === 0 && !showVectorStoreForm && (
                  <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                    No vector stores. Use Bundled for in-app search, or add Qdrant/Pinecone/pgvector
                    for external.
                  </p>
                )}
              </section>
            )}

            {activeTab === "stores" && (
              <section>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.75rem",
                  }}
                >
                  <h2 style={{ margin: 0, fontSize: "1rem" }}>Document stores (S3, MinIO, GCS)</h2>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setShowStoreForm(!showStoreForm)}
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
                {showStoreForm && (
                  <form
                    onSubmit={createStore}
                    className="form"
                    style={{
                      marginBottom: "1rem",
                      padding: "1rem",
                      background: "var(--bg-subtle)",
                      borderRadius: "var(--radius)",
                    }}
                  >
                    <div className="field">
                      <label>Name</label>
                      <input
                        className="input"
                        value={storeName}
                        onChange={(e) => setStoreName(e.target.value)}
                        placeholder="e.g. My S3 bucket"
                      />
                    </div>
                    <div
                      style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}
                    >
                      <div className="field">
                        <label>Type</label>
                        <select
                          className="select"
                          value={storeType}
                          onChange={(e) => setStoreType(e.target.value as "s3" | "minio" | "gcs")}
                        >
                          <option value="s3">S3</option>
                          <option value="minio">MinIO</option>
                          <option value="gcs">GCS</option>
                        </select>
                      </div>
                      <div className="field">
                        <label>Bucket</label>
                        <input
                          className="input"
                          value={storeBucket}
                          onChange={(e) => setStoreBucket(e.target.value)}
                          placeholder="bucket-name"
                          required
                        />
                      </div>
                    </div>
                    <div className="field">
                      <label>Region (optional)</label>
                      <input
                        className="input"
                        value={storeRegion}
                        onChange={(e) => setStoreRegion(e.target.value)}
                        placeholder="us-east-1"
                      />
                    </div>
                    <div className="field">
                      <label>Endpoint (optional, for MinIO/custom S3)</label>
                      <input
                        className="input"
                        value={storeEndpoint}
                        onChange={(e) => setStoreEndpoint(e.target.value)}
                        placeholder="https://..."
                      />
                    </div>
                    <div className="field">
                      <label>Credentials ref (optional)</label>
                      <input
                        className="input"
                        value={storeCredentialsRef}
                        onChange={(e) => setStoreCredentialsRef(e.target.value)}
                        placeholder="env var or secret name"
                      />
                    </div>
                    <button type="submit" className="button button-primary" disabled={savingStore}>
                      {savingStore ? "Saving..." : "Create"}
                    </button>
                  </form>
                )}
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {stores.map((s) => (
                    <li
                      key={s.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "0.5rem 0",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <span>
                        <strong>{s.name}</strong> — {s.type} / {s.bucket}
                        {s.region ? ` (${s.region})` : ""}
                      </span>
                      <button
                        type="button"
                        className="button button-danger"
                        style={{ padding: "0.25rem 0.5rem" }}
                        onClick={() => setDeleteTarget({ type: "stores", id: s.id, name: s.name })}
                      >
                        <Trash2 size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
                {stores.length === 0 && !showStoreForm && (
                  <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                    No document stores. Add one to store uploaded files and sync from external
                    sources.
                  </p>
                )}
              </section>
            )}

            {activeTab === "collections" && (
              <section>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.75rem",
                  }}
                >
                  <h2 style={{ margin: 0, fontSize: "1rem" }}>Collections</h2>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setShowCollectionForm(!showCollectionForm)}
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
                {studioCollection && (
                  <p
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      marginBottom: "0.75rem",
                    }}
                  >
                    Studio chat uses the <strong>deployment</strong> collection:{" "}
                    {studioCollection.name}.
                  </p>
                )}
                {showCollectionForm && (
                  <form
                    onSubmit={createCollection}
                    className="form"
                    style={{
                      marginBottom: "1rem",
                      padding: "1rem",
                      background: "var(--bg-subtle)",
                      borderRadius: "var(--radius)",
                    }}
                  >
                    <div className="field">
                      <label>Name</label>
                      <input
                        className="input"
                        value={collName}
                        onChange={(e) => setCollName(e.target.value)}
                        placeholder="e.g. Studio knowledge"
                        required
                      />
                    </div>
                    <div className="field">
                      <label>Scope</label>
                      <select
                        className="select"
                        value={collScope}
                        onChange={(e) => setCollScope(e.target.value as "deployment" | "agent")}
                      >
                        <option value="deployment">Deployment (studio chat)</option>
                        <option value="agent">Agent</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Encoding config</label>
                      <select
                        className="select"
                        value={collEncodingId}
                        onChange={(e) => setCollEncodingId(e.target.value)}
                        required
                      >
                        <option value="">Select...</option>
                        {encodingConfigs.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>Document store</label>
                      <select
                        className="select"
                        value={collStoreId}
                        onChange={(e) => setCollStoreId(e.target.value)}
                        required
                      >
                        <option value="">Select...</option>
                        {stores.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>Vector store (optional)</label>
                      <select
                        className="select"
                        value={collVectorStoreId}
                        onChange={(e) => setCollVectorStoreId(e.target.value)}
                      >
                        <option value="">Bundled (default)</option>
                        {vectorStores.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} ({v.type})
                          </option>
                        ))}
                      </select>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        Bundled stores vectors in the app. Choose an external store for scale.
                      </span>
                    </div>
                    <button type="submit" className="button button-primary" disabled={savingColl}>
                      {savingColl ? "Saving..." : "Create"}
                    </button>
                  </form>
                )}
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {collections.map((c) => (
                    <li
                      key={c.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "0.5rem 0",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <span>
                        <strong>{c.name}</strong> — {c.scope}
                        {c.scope === "agent" && c.agentId ? ` (agent ${c.agentId})` : ""}
                      </span>
                      <button
                        type="button"
                        className="button button-danger"
                        style={{ padding: "0.25rem 0.5rem" }}
                        onClick={() =>
                          setDeleteTarget({ type: "collections", id: c.id, name: c.name })
                        }
                      >
                        <Trash2 size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
                {collections.length === 0 && !showCollectionForm && (
                  <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                    Create a deployment collection to give the chat context; agents can use it or a
                    custom collection.
                  </p>
                )}
                {studioCollection && (
                  <div
                    style={{
                      marginTop: "1rem",
                      padding: "1rem",
                      background: "var(--bg-subtle)",
                      borderRadius: "var(--radius)",
                    }}
                  >
                    <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>
                      Upload to studio knowledge
                    </h3>
                    <p
                      style={{
                        fontSize: "0.85rem",
                        color: "var(--text-muted)",
                        margin: "0 0 0.5rem",
                      }}
                    >
                      Connectors that sync to the deployment collection are searchable in chat after
                      you Ingest their documents. Upload .txt or .md files, or sync from Connectors;
                      then Ingest to chunk and embed so chat can use them.
                    </p>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const fd = new FormData(form);
                        const res = await fetch("/api/rag/upload", { method: "POST", body: fd });
                        if (res.ok) {
                          (form.querySelector('input[type="file"]') as HTMLInputElement).value = "";
                          loadAll();
                        } else {
                          const err = await res.json().catch(() => ({}));
                          alert(err?.error || "Upload failed");
                        }
                      }}
                      style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}
                    >
                      <input
                        type="file"
                        name="file"
                        accept=".txt,.md"
                        style={{ fontSize: "0.9rem" }}
                      />
                      <input type="hidden" name="collectionId" value={studioCollection.id} />
                      <button type="submit" className="button button-primary">
                        Upload
                      </button>
                    </form>
                    <StudioDocumentsList collectionId={studioCollection.id} onIngest={loadAll} />
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>

      {connectorForItems && (
        <div
          className="modal-overlay"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => !savingSelection && setConnectorForItems(null)}
        >
          <div
            className="card"
            style={{
              maxWidth: "28rem",
              width: "90%",
              maxHeight: "85vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 0.5rem" }}>Select items to sync</h3>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
              Only selected items will be synced. Clear selection and use &quot;Sync all&quot; to
              sync everything.
            </p>
            {TEXT_BASED_CONNECTOR_TYPES.has(connectorForItems.type) && (
              <button
                type="button"
                className="button button-primary"
                style={{ marginBottom: "0.75rem" }}
                onClick={runSyncAll}
                disabled={savingSelection}
              >
                Sync all (no filter)
              </button>
            )}
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <button
                type="button"
                className="button button-small"
                onClick={selectAllBrowse}
                disabled={browseItems.length === 0}
              >
                <CheckSquare size={12} /> Select all
              </button>
              <button type="button" className="button button-small" onClick={deselectAllBrowse}>
                <Square size={12} /> Deselect all
              </button>
            </div>
            {browseLoading && browseItems.length === 0 ? (
              <p style={{ color: "var(--text-muted)" }}>Loading items…</p>
            ) : (
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: "0.25rem",
                  overflow: "auto",
                  flex: 1,
                  minHeight: "8rem",
                  maxHeight: "20rem",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                }}
              >
                {browseItems.map((item) => (
                  <li
                    key={item.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.35rem 0.5rem",
                      borderRadius: "var(--radius)",
                      cursor: "pointer",
                      background: selectedItemIds.has(item.id) ? "var(--bg-subtle)" : undefined,
                    }}
                    onClick={() => toggleItemId(item.id)}
                  >
                    {selectedItemIds.has(item.id) ? (
                      <CheckSquare size={16} style={{ flexShrink: 0 }} />
                    ) : (
                      <Square size={16} style={{ flexShrink: 0 }} />
                    )}
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.name}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {browseNextToken && (
              <button
                type="button"
                className="button button-small"
                style={{ marginTop: "0.5rem" }}
                onClick={loadMoreBrowse}
                disabled={browseLoading}
              >
                {browseLoading ? "Loading…" : "Load more"}
              </button>
            )}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button
                type="button"
                className="button button-primary"
                onClick={runSaveSelection}
                disabled={savingSelection}
              >
                {savingSelection ? "Saving…" : "Save selection"}
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setConnectorForItems(null)}
                disabled={savingSelection}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete"
        message={deleteTarget ? `Delete "${deleteTarget.name}"? This cannot be undone.` : ""}
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
        confirmLabel="Delete"
        loading={deleting}
        danger
      />
    </div>
  );
}
