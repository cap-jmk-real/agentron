# Logs, outputs, and RAG

## Logs and outputs (Electron-friendly storage)

Agent and workflow **outputs** are stored in the `executions` table (`output` column). **Run logs** (per-step or streaming logs) are stored in the `run_logs` table.

**Database choice for Electron:** We use **SQLite** for both. SQLite is the standard choice for desktop apps:

- **Single file** – no separate server; bundles with the app.
- **No setup** – works out of the box in Electron (e.g. via `better-sqlite3`).
- **ACID** – safe for concurrent writes and app restarts.
- **Portable** – the `.data/agentron.sqlite` file can be backed up or moved.

Alternatives like **LevelDB** (key-value, good for append-heavy logs) are also easy to bundle with Electron, but SQLite keeps one database for runs, logs, and the rest of the app, which simplifies backups and tooling.

**APIs:**

- `PATCH /api/runs/{id}` – set `status`, `output`, `finishedAt` when a run completes.
- `GET /api/runs/{id}/logs` – list log entries for a run.
- `POST /api/runs/{id}/logs` – append log entries (e.g. from the executor).

---

## RAG (retrieval-augmented generation)

RAG is supported at two levels:

- **Per-agent** – a collection scoped to one agent (`scope: "agent"`, `agentId` set).
- **Deployment-wide** – a shared collection (`scope: "deployment"`, `agentId` null).

### Vector encoding (user-configured)

Encoding is configured via **encoding config** (`/api/rag/encoding-config`). You choose:

- **Provider** – e.g. `openai`, `sentence-transformers`, or a custom embedding endpoint.
- **Model or endpoint** – e.g. `text-embedding-3-small` or `http://localhost:8080/embed`.
- **Dimensions** – vector size (must match the model).

**When the user changes the encoding algorithm**, all vectors for collections using that config must be recomputed. The application should:

1. Enqueue a re-encode job for each affected collection (documents → chunks → new embeddings).
2. Write new vectors to the vector store and replace or version the index.
3. Keep document metadata in `rag_documents`; vector storage can be SQLite (e.g. `sqlite-vec`), Chroma, Qdrant, or another vector DB.

### Document store (MinIO, S3, GCS)

The **document store** (`/api/rag/document-store`) is where raw files live. The user configures:

- **Type** – `minio`, `s3`, `gcs`, etc.
- **Bucket** – bucket name.
- **Endpoint** – for MinIO: e.g. `http://minio:9000` (Docker) or `http://localhost:9000`.
- **Region / credentials** – as needed for the provider.

**Docker + MinIO:** Add MinIO to your stack and create a bucket (e.g. `agentos-docs`). In the document store config, set `type: "minio"`, `bucket: "agentos-docs"`, `endpoint: "http://minio:9000"`. No extra DB is required for the blob store; MinIO is the document store.

### Document ingestion

Documents can be added by:

- **File upload** – upload to the configured store (e.g. MinIO), then create `rag_documents` rows and index chunks into the vector DB.
- **Connectors** – e.g. Google Drive, Dropbox. Connectors (`rag_connectors` table) store OAuth tokens and sync config; a sync job fetches files, uploads them to the document store, and updates `rag_documents` and vectors.

### API summary

- **Encoding config:** `GET/POST /api/rag/encoding-config`, `GET/PUT/DELETE /api/rag/encoding-config/{id}`.
- **Document store:** `GET/POST /api/rag/document-store`, `GET/PUT/DELETE /api/rag/document-store/{id}`.
- **Collections:** `GET/POST /api/rag/collections`, `GET/PUT/DELETE /api/rag/collections/{id}` (each collection has `encodingConfigId`, `documentStoreId`, and optional `agentId` for agent-scoped RAG).

Implementations for vector storage, chunking, re-encoding jobs, and connector sync are left to the runtime layer; the API and schema provide the configuration and document metadata.
