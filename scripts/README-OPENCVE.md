# OpenCVE local deployment for CVE search API

One script deploys [OpenCVE](https://docs.opencve.io/deployment/): stack, API user (username/password), clone repos, import CVE KB (10–30 min), unpause DAG, and test API. Used by the red-vs-blue e2e and the optional `std-cve-search` tool.

## 1. Start Podman or Docker

The script uses **Podman** if it is running, otherwise **Docker**. Start one of them before running the deploy (e.g. Podman Desktop or Docker Desktop). To force an engine: `-Engine podman` or `-Engine docker`.

**Ports:** The script picks **free ports** automatically for OpenCVE (web/API) and Airflow, writes them to `opencve/docker/.env`, and uses the OpenCVE port for the API test. No manual port configuration needed. OpenCVE’s API requires **Basic Auth** (no option for anonymous read); the script creates the user and passes the same credentials to the test.

## 2. Run the full deploy

From the **agentron repo root**:

```bash
npm run opencve-deploy
```

Or with PowerShell (to set OpenCVE path or credentials):

```powershell
.\scripts\opencve-deploy.ps1 -OpenCveDir "C:\Users\Julian\Documents\Programming\opencve" -ApiUser opencve -ApiPassword opencve
```

- **Default**: full deploy (stack + user + clone repos + import CVE data + test). Import takes 10–30 min.
- **Quick deploy** (stack + user only): add `-QuickDeploy`.
- Default OpenCVE path: sibling of the agentron repo. Override with `-OpenCveDir "C:\path\to\opencve"`.
- Web UI: http://localhost (port 80). API: http://localhost/api/cve

## 3. Query the API

```bash
node scripts/opencve-query-api.mjs http://localhost opencve opencve
```

Or with custom base URL and credentials:

```bash
node scripts/opencve-query-api.mjs https://opencve.example.com myuser mypassword
```

The script calls `GET /api/cve?search=Shellshock` and `GET /api/cve/CVE-2014-6271` with Basic Auth and prints the response.
