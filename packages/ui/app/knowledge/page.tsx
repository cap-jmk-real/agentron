"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Database, Settings, FolderOpen, Box, Cloud } from "lucide-react";
import ConfirmModal from "../components/confirm-modal";

type EncodingConfig = {
  id: string;
  name: string;
  provider: string;
  modelOrEndpoint: string;
  dimensions: number;
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
  createdAt: number;
};

type TabId = "encoding" | "stores" | "vectorstores" | "collections" | "connectors";

type DocItem = { id: string; storePath: string; metadata?: { originalName?: string }; createdAt: number };

function StudioDocumentsList({ collectionId, onIngest }: { collectionId: string; onIngest: () => void }) {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [ingestingId, setIngestingId] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/rag/documents?collectionId=${encodeURIComponent(collectionId)}`)
      .then((r) => r.json())
      .then((d) => setDocs(Array.isArray(d) ? d : []))
      .catch(() => setDocs([]));
  }, [collectionId]);
  const runIngest = async (documentId: string) => {
    setIngestingId(documentId);
    try {
      const res = await fetch("/api/rag/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) alert(`Ingested ${data.chunks ?? 0} chunks.`);
      else alert(data?.error || "Ingest failed");
      onIngest();
    } finally {
      setIngestingId(null);
    }
  };
  if (docs.length === 0) return null;
  return (
    <div style={{ marginTop: "1rem" }}>
      <h4 style={{ margin: "0 0 0.35rem", fontSize: "0.9rem" }}>Uploaded documents</h4>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "0.85rem" }}>
        {docs.map((d) => (
          <li key={d.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.25rem 0" }}>
            <span style={{ flex: 1 }}>{d.metadata?.originalName ?? d.storePath}</span>
            <button type="button" className="button button-small" onClick={() => runIngest(d.id)} disabled={!!ingestingId}>
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
  const [deleteTarget, setDeleteTarget] = useState<{ type: TabId; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [syncingConnectorId, setSyncingConnectorId] = useState<string | null>(null);

  // Encoding form
  const [encName, setEncName] = useState("");
  const [encProvider, setEncProvider] = useState("openai");
  const [encModel, setEncModel] = useState("text-embedding-3-small");
  const [encDimensions, setEncDimensions] = useState("1536");
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
  const [vecStoreType, setVecStoreType] = useState<"bundled" | "qdrant" | "pinecone" | "pgvector">("bundled");
  const [savingVecStore, setSavingVecStore] = useState(false);

  const [connectorType, setConnectorType] = useState<"google_drive">("google_drive");
  const [connectorCollectionId, setConnectorCollectionId] = useState("");
  const [connectorFolderId, setConnectorFolderId] = useState("root");
  const [connectorServiceAccountKeyRef, setConnectorServiceAccountKeyRef] = useState("");
  const [savingConnector, setSavingConnector] = useState(false);

  const loadAll = useCallback(async () => {
    const [encRes, storeRes, vecRes, collRes, connRes] = await Promise.all([
      fetch("/api/rag/encoding-config"),
      fetch("/api/rag/document-store"),
      fetch("/api/rag/vector-store"),
      fetch("/api/rag/collections"),
      fetch("/api/rag/connectors"),
    ]);
    const enc = await encRes.json();
    const st = await storeRes.json();
    const vec = await vecRes.json();
    const coll = await collRes.json();
    const conn = await connRes.json();
    setEncodingConfigs(Array.isArray(enc) ? enc : []);
    setStores(Array.isArray(st) ? st : []);
    setVectorStores(Array.isArray(vec) ? vec : []);
    setCollections(Array.isArray(coll) ? coll : []);
    setConnectors(Array.isArray(conn) ? conn : []);
  }, []);

  useEffect(() => {
    setLoading(true);
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  const createEncoding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!encName.trim()) return;
    setSavingEnc(true);
    try {
      await fetch("/api/rag/encoding-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: encName.trim(),
          provider: encProvider,
          modelOrEndpoint: encModel,
          dimensions: parseInt(encDimensions, 10) || 1536,
        }),
      });
      await loadAll();
      setEncName("");
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

  const createConnector = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectorCollectionId) return;
    setSavingConnector(true);
    try {
      await fetch("/api/rag/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: connectorType,
          collectionId: connectorCollectionId,
          config: {
            folderId: connectorFolderId || "root",
            serviceAccountKeyRef: connectorServiceAccountKeyRef || undefined,
          },
        }),
      });
      await loadAll();
      setConnectorCollectionId("");
      setConnectorFolderId("root");
      setConnectorServiceAccountKeyRef("");
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
        <Link href="/" className="back-link" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.5rem" }}>
          <ArrowLeft size={14} /> Overview
        </Link>
        <h1 style={{ margin: 0, fontSize: "1.35rem" }}>Knowledge (RAG)</h1>
        <p style={{ margin: "0.35rem 0 0", fontSize: "0.9rem", color: "var(--text-muted)" }}>
          Studio knowledge powers the chat assistant. Create a <strong>deployment</strong> collection to give the chat context. Agents can use that or a custom collection.
        </p>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", borderBottom: "1px solid var(--border)", paddingBottom: "0.75rem", marginBottom: "1rem" }}>
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                  <h2 style={{ margin: 0, fontSize: "1rem" }}>Embedding model</h2>
                  <button type="button" className="button" onClick={() => setShowEncodingForm(!showEncodingForm)}>
                    <Plus size={14} /> Add
                  </button>
                </div>
                {showEncodingForm && (
                  <form onSubmit={createEncoding} className="form" style={{ marginBottom: "1rem", padding: "1rem", background: "var(--bg-subtle)", borderRadius: "var(--radius)" }}>
                    <div className="field">
                      <label>Name</label>
                      <input className="input" value={encName} onChange={(e) => setEncName(e.target.value)} placeholder="e.g. OpenAI embeddings" />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                      <div className="field">
                        <label>Provider</label>
                        <input className="input" value={encProvider} onChange={(e) => setEncProvider(e.target.value)} />
                      </div>
                      <div className="field">
                        <label>Model / endpoint</label>
                        <input className="input" value={encModel} onChange={(e) => setEncModel(e.target.value)} />
                      </div>
                    </div>
                    <div className="field">
                      <label>Dimensions</label>
                      <input className="input" type="number" value={encDimensions} onChange={(e) => setEncDimensions(e.target.value)} />
                    </div>
                    <button type="submit" className="button button-primary" disabled={savingEnc}>
                      {savingEnc ? "Saving..." : "Create"}
                    </button>
                  </form>
                )}
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {encodingConfigs.map((e) => (
                    <li key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>
                      <span><strong>{e.name}</strong> — {e.provider} / {e.modelOrEndpoint} ({e.dimensions}d)</span>
                      <button type="button" className="button button-danger" style={{ padding: "0.25rem 0.5rem" }} onClick={() => setDeleteTarget({ type: "encoding", id: e.id, name: e.name })}>
                        <Trash2 size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
                <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginTop: "0.5rem" }}>Used to vectorize documents and queries for RAG. Use the same provider as in LLM Providers (e.g. OpenAI) and set the API key there.</p>
                {encodingConfigs.length === 0 && !showEncodingForm && <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No embedding configs. Add one to use with collections.</p>}
              </section>
            )}

            {activeTab === "connectors" && (
              <section>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                  <h2 style={{ margin: 0, fontSize: "1rem" }}>Connectors</h2>
                  <button type="button" className="button" onClick={() => setShowConnectorForm(!showConnectorForm)}>
                    <Plus size={14} /> Add
                  </button>
                </div>
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>Sync external sources (e.g. Google Drive) into a collection&apos;s document store. Synced files appear as documents; run Ingest on them to add to the vector store.</p>
                {showConnectorForm && (
                  <form onSubmit={createConnector} className="form" style={{ marginBottom: "1rem", padding: "1rem", background: "var(--bg-subtle)", borderRadius: "var(--radius)" }}>
                    <div className="field">
                      <label>Type</label>
                      <select className="select" value={connectorType} onChange={(e) => setConnectorType(e.target.value as "google_drive")}>
                        <option value="google_drive">Google Drive</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Collection</label>
                      <select className="select" value={connectorCollectionId} onChange={(e) => setConnectorCollectionId(e.target.value)} required>
                        <option value="">Select...</option>
                        {collections.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>Folder ID (optional)</label>
                      <input className="input" value={connectorFolderId} onChange={(e) => setConnectorFolderId(e.target.value)} placeholder="root or Google Drive folder ID" />
                    </div>
                    <div className="field">
                      <label>Service account key (env var name)</label>
                      <input className="input" value={connectorServiceAccountKeyRef} onChange={(e) => setConnectorServiceAccountKeyRef(e.target.value)} placeholder="GOOGLE_SERVICE_ACCOUNT_JSON" />
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Env var containing the full service account JSON key.</span>
                    </div>
                    <button type="submit" className="button button-primary" disabled={savingConnector}>
                      {savingConnector ? "Saving..." : "Create"}
                    </button>
                  </form>
                )}
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {connectors.map((c) => (
                    <li key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>
                      <span><strong>{c.type}</strong> → {collections.find((x) => x.id === c.collectionId)?.name ?? c.collectionId} · {c.status}{c.lastSyncAt ? ` · last sync ${new Date(c.lastSyncAt).toLocaleString()}` : ""}</span>
                      <div style={{ display: "flex", gap: "0.35rem" }}>
                        <button type="button" className="button button-small" onClick={() => runConnectorSync(c.id)} disabled={!!syncingConnectorId}>
                          {syncingConnectorId === c.id ? "Syncing…" : "Sync"}
                        </button>
                        <button type="button" className="button button-danger button-small" onClick={() => setDeleteTarget({ type: "connectors", id: c.id, name: c.type })}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {connectors.length === 0 && !showConnectorForm && <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No connectors. Add one to sync Google Drive (or other sources) into a collection.</p>}
              </section>
            )}

            {activeTab === "vectorstores" && (
              <section>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                  <h2 style={{ margin: 0, fontSize: "1rem" }}>Vector stores</h2>
                  <button type="button" className="button" onClick={() => setShowVectorStoreForm(!showVectorStoreForm)}>
                    <Plus size={14} /> Add
                  </button>
                </div>
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>Bundled stores vectors in the app database. Use an external store (Qdrant, Pinecone, pgvector) for larger scale.</p>
                {showVectorStoreForm && (
                  <form onSubmit={createVectorStore} className="form" style={{ marginBottom: "1rem", padding: "1rem", background: "var(--bg-subtle)", borderRadius: "var(--radius)" }}>
                    <div className="field">
                      <label>Name</label>
                      <input className="input" value={vecStoreName} onChange={(e) => setVecStoreName(e.target.value)} placeholder="e.g. Bundled" />
                    </div>
                    <div className="field">
                      <label>Type</label>
                      <select className="select" value={vecStoreType} onChange={(e) => setVecStoreType(e.target.value as "bundled" | "qdrant" | "pinecone" | "pgvector")}>
                        <option value="bundled">Bundled (in-app)</option>
                        <option value="qdrant">Qdrant</option>
                        <option value="pinecone">Pinecone</option>
                        <option value="pgvector">pgvector (Postgres)</option>
                      </select>
                    </div>
                    <button type="submit" className="button button-primary" disabled={savingVecStore}>
                      {savingVecStore ? "Saving..." : "Create"}
                    </button>
                  </form>
                )}
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {vectorStores.map((v) => (
                    <li key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>
                      <span><strong>{v.name}</strong> — {v.type}</span>
                      <button type="button" className="button button-danger" style={{ padding: "0.25rem 0.5rem" }} onClick={() => setDeleteTarget({ type: "vectorstores", id: v.id, name: v.name })}>
                        <Trash2 size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
                {vectorStores.length === 0 && !showVectorStoreForm && <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No vector stores. Use Bundled for in-app search, or add Qdrant/Pinecone/pgvector for external.</p>}
              </section>
            )}

            {activeTab === "stores" && (
              <section>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                  <h2 style={{ margin: 0, fontSize: "1rem" }}>Document stores (S3, MinIO, GCS)</h2>
                  <button type="button" className="button" onClick={() => setShowStoreForm(!showStoreForm)}>
                    <Plus size={14} /> Add
                  </button>
                </div>
                {showStoreForm && (
                  <form onSubmit={createStore} className="form" style={{ marginBottom: "1rem", padding: "1rem", background: "var(--bg-subtle)", borderRadius: "var(--radius)" }}>
                    <div className="field">
                      <label>Name</label>
                      <input className="input" value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="e.g. My S3 bucket" />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                      <div className="field">
                        <label>Type</label>
                        <select className="select" value={storeType} onChange={(e) => setStoreType(e.target.value as "s3" | "minio" | "gcs")}>
                          <option value="s3">S3</option>
                          <option value="minio">MinIO</option>
                          <option value="gcs">GCS</option>
                        </select>
                      </div>
                      <div className="field">
                        <label>Bucket</label>
                        <input className="input" value={storeBucket} onChange={(e) => setStoreBucket(e.target.value)} placeholder="bucket-name" required />
                      </div>
                    </div>
                    <div className="field">
                      <label>Region (optional)</label>
                      <input className="input" value={storeRegion} onChange={(e) => setStoreRegion(e.target.value)} placeholder="us-east-1" />
                    </div>
                    <div className="field">
                      <label>Endpoint (optional, for MinIO/custom S3)</label>
                      <input className="input" value={storeEndpoint} onChange={(e) => setStoreEndpoint(e.target.value)} placeholder="https://..." />
                    </div>
                    <div className="field">
                      <label>Credentials ref (optional)</label>
                      <input className="input" value={storeCredentialsRef} onChange={(e) => setStoreCredentialsRef(e.target.value)} placeholder="env var or secret name" />
                    </div>
                    <button type="submit" className="button button-primary" disabled={savingStore}>
                      {savingStore ? "Saving..." : "Create"}
                    </button>
                  </form>
                )}
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {stores.map((s) => (
                    <li key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>
                      <span><strong>{s.name}</strong> — {s.type} / {s.bucket}{s.region ? ` (${s.region})` : ""}</span>
                      <button type="button" className="button button-danger" style={{ padding: "0.25rem 0.5rem" }} onClick={() => setDeleteTarget({ type: "stores", id: s.id, name: s.name })}>
                        <Trash2 size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
                {stores.length === 0 && !showStoreForm && <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No document stores. Add one to store uploaded files and sync from external sources.</p>}
              </section>
            )}

            {activeTab === "collections" && (
              <section>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                  <h2 style={{ margin: 0, fontSize: "1rem" }}>Collections</h2>
                  <button type="button" className="button" onClick={() => setShowCollectionForm(!showCollectionForm)}>
                    <Plus size={14} /> Add
                  </button>
                </div>
                {studioCollection && (
                  <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                    Studio chat uses the <strong>deployment</strong> collection: {studioCollection.name}.
                  </p>
                )}
                {showCollectionForm && (
                  <form onSubmit={createCollection} className="form" style={{ marginBottom: "1rem", padding: "1rem", background: "var(--bg-subtle)", borderRadius: "var(--radius)" }}>
                    <div className="field">
                      <label>Name</label>
                      <input className="input" value={collName} onChange={(e) => setCollName(e.target.value)} placeholder="e.g. Studio knowledge" required />
                    </div>
                    <div className="field">
                      <label>Scope</label>
                      <select className="select" value={collScope} onChange={(e) => setCollScope(e.target.value as "deployment" | "agent")}>
                        <option value="deployment">Deployment (studio chat)</option>
                        <option value="agent">Agent</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Encoding config</label>
                      <select className="select" value={collEncodingId} onChange={(e) => setCollEncodingId(e.target.value)} required>
                        <option value="">Select...</option>
                        {encodingConfigs.map((e) => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>Document store</label>
                      <select className="select" value={collStoreId} onChange={(e) => setCollStoreId(e.target.value)} required>
                        <option value="">Select...</option>
                        {stores.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>Vector store (optional)</label>
                      <select className="select" value={collVectorStoreId} onChange={(e) => setCollVectorStoreId(e.target.value)}>
                        <option value="">Bundled (default)</option>
                        {vectorStores.map((v) => (
                          <option key={v.id} value={v.id}>{v.name} ({v.type})</option>
                        ))}
                      </select>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Bundled stores vectors in the app. Choose an external store for scale.</span>
                    </div>
                    <button type="submit" className="button button-primary" disabled={savingColl}>
                      {savingColl ? "Saving..." : "Create"}
                    </button>
                  </form>
                )}
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {collections.map((c) => (
                    <li key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>
                      <span><strong>{c.name}</strong> — {c.scope}{c.scope === "agent" && c.agentId ? ` (agent ${c.agentId})` : ""}</span>
                      <button type="button" className="button button-danger" style={{ padding: "0.25rem 0.5rem" }} onClick={() => setDeleteTarget({ type: "collections", id: c.id, name: c.name })}>
                        <Trash2 size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
                {collections.length === 0 && !showCollectionForm && <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Create a deployment collection to give the chat context; agents can use it or a custom collection.</p>}
                {studioCollection && (
                  <div style={{ marginTop: "1rem", padding: "1rem", background: "var(--bg-subtle)", borderRadius: "var(--radius)" }}>
                    <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>Upload to studio knowledge</h3>
                    <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>Upload .txt or .md files. Then click Ingest to chunk and embed into the vector store so chat can use them.</p>
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
                      <input type="file" name="file" accept=".txt,.md" style={{ fontSize: "0.9rem" }} />
                      <input type="hidden" name="collectionId" value={studioCollection.id} />
                      <button type="submit" className="button button-primary">Upload</button>
                    </form>
                    <StudioDocumentsList collectionId={studioCollection.id} onIngest={loadAll} />
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete"
        message={deleteTarget ? `Delete "${deleteTarget.name}"? This cannot be undone.` : ""}
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
        confirmLabel="Delete"
        loading={deleting}
        variant="danger"
      />
    </div>
  );
}
