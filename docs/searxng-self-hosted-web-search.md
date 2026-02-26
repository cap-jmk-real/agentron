# Self-hosted web search with SearXNG

Use a self-hosted [SearXNG](https://docs.searxng.org/) instance as the web search provider in Agentron Studio. No API key is required; you only need to run SearXNG and enable its JSON API.

## Prerequisites

- **Docker or Podman** (same as Studio’s container engine). Ensure it is installed and running.

## Setup

### 1. Create directories

```bash
mkdir -p ./searxng/config ./searxng/data
cd ./searxng
```

### 2. Enable the JSON API

Create `./searxng/config/settings.yml` with at least:

```yaml
search:
  formats:
    - json
```

This allows Studio to request `?format=json` and receive structured results. Without it, SearXNG returns 403 Forbidden for JSON requests.

### 3. Run the container

**Docker:**

```bash
docker run -d --name searxng -p 8888:8080 \
  -v "./config:/etc/searxng" \
  -v "./data:/var/cache/searxng" \
  docker.io/searxng/searxng:latest
```

**Podman:** Replace `docker` with `podman` in the command above.

SearXNG listens on port 8080 inside the container; `-p 8888:8080` exposes it on port 8888 on the host. Use a different host port if 8888 is already in use (and set that URL in Studio).

### 4. Verify

```bash
curl 'http://localhost:8888/search?q=test&format=json'
```

You should get JSON with a `results` array. If you see **403 Forbidden**, ensure `search.formats: [json]` is present in `config/settings.yml` and restart the container.

### 5. Configure Studio

1. Open **Settings** in Agentron Studio.
2. Under **Web search**, set **Search provider** to **SearXNG (self-hosted)**.
3. Set **SearXNG base URL** to `http://localhost:8888` (or your host/port).
4. Click **Save**.

Chat and workflows that use the web search tool will now query your SearXNG instance.

## Troubleshooting

| Issue | What to do |
|-------|------------|
| **403** when requesting `format=json` | Add `search.formats: [json]` in `settings.yml` and restart the container. |
| **Connection refused** | Ensure the container is running (`docker ps` or `podman ps`) and the base URL port matches (`-p 8888:8080` → `http://localhost:8888`). |
| **Port 8888 in use** | Use another port, e.g. `-p 9999:8080`, and set base URL to `http://localhost:9999`. |

## Reference

- [SearXNG installation (Docker)](https://docs.searxng.org/admin/installation-docker.html#installation-container)
- [SearXNG search API (JSON)](https://docs.searxng.org/dev/search_api.html)
