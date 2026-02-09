# Agentron Server API Contract (Studio View)

This document defines the minimal HTTP API surface the Studio uses when connected to a remote Server.

## Base

- Base URL configured by user, default `http://localhost:PORT`.
- All payloads are JSON.

## Endpoints

- `GET /api/agents`
- `POST /api/agents`
- `GET /api/agents/{id}`
- `PUT /api/agents/{id}`
- `DELETE /api/agents/{id}`
- `POST /api/agents/{id}/execute`
- `GET /api/agents/{id}/skills` (list skills attached to agent)
- `POST /api/agents/{id}/skills` (attach skill; body: `{ skillId, sortOrder?, config? }`)
- `DELETE /api/agents/{id}/skills` (detach skill; body: `{ skillId }`)

- `GET /api/skills`
- `POST /api/skills`
- `GET /api/skills/{id}`
- `PUT /api/skills/{id}`
- `DELETE /api/skills/{id}`

- `GET /api/workflows`
- `POST /api/workflows`
- `GET /api/workflows/{id}`
- `PUT /api/workflows/{id}`
- `DELETE /api/workflows/{id}`
- `POST /api/workflows/{id}/execute`

- `GET /api/llm/providers`
- `POST /api/llm/providers`
- `PUT /api/llm/providers/{id}`
- `DELETE /api/llm/providers/{id}`
- `POST /api/llm/providers/{id}/test`

- `GET /api/tools`
- `POST /api/tools`
- `PUT /api/tools/{id}`
- `DELETE /api/tools/{id}`

- `GET /api/runs`
- `GET /api/runs/{id}`
- `PATCH /api/runs/{id}` (status, output, finishedAt)
- `GET /api/runs/{id}/logs`
- `POST /api/runs/{id}/logs` (append log entries)

- `GET /api/rag/encoding-config`
- `POST /api/rag/encoding-config`
- `GET /api/rag/encoding-config/{id}`
- `PUT /api/rag/encoding-config/{id}`
- `DELETE /api/rag/encoding-config/{id}`

- `GET /api/rag/document-store`
- `POST /api/rag/document-store`
- `GET /api/rag/document-store/{id}`
- `PUT /api/rag/document-store/{id}`
- `DELETE /api/rag/document-store/{id}`

- `GET /api/rag/collections`
- `POST /api/rag/collections`
- `GET /api/rag/collections/{id}`
- `PUT /api/rag/collections/{id}`
- `DELETE /api/rag/collections/{id}`

## MCP

When Studio connects to a Server in MCP mode, it targets the Server MCP endpoint as configured in settings.

