import type { AssistantToolDef } from "./types";

export const REMOTE_TOOLS: AssistantToolDef[] = [
  {
    name: "list_remote_servers",
    description:
      "List saved remote servers used for custom-deployed LLM access (e.g. SSH tunnel to Ollama). Use when the user asks what remote servers are saved or wants to use one for a new agent.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "test_remote_connection",
    description:
      "Test SSH connection to a remote host. Use when the user is setting up remote access to a custom-deployed model and has provided SSH details (host, user, optional port, key path or password). If connection fails, you will get guidance to share with the user (server firewall, cloud security groups, sshd_config). Ask the user if they want you to apply suggested server changes if they have access; ask them to change cloud provider settings if needed. After a successful test or manual success, ask if they want to save the server for use with new agents.",
    parameters: {
      type: "object",
      properties: {
        host: { type: "string", description: "SSH host (IP or hostname)" },
        port: { type: "number", description: "SSH port (default 22)" },
        user: { type: "string", description: "SSH username" },
        authType: { type: "string", enum: ["key", "password"], description: "key or password" },
        keyPath: {
          type: "string",
          description:
            "Path to private key file (required for automated test when authType is key)",
        },
      },
      required: ["host", "user", "authType"],
    },
  },
  {
    name: "save_remote_server",
    description:
      "Save a remote server configuration for use with new agents. Call this when the user confirms they want to save after a successful connection test (or after they tested manually). Do not store passwords; for password auth we only save host/port/user and the user will be prompted when using.",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "Friendly name for this server" },
        host: { type: "string" },
        port: { type: "number", description: "SSH port (default 22)" },
        user: { type: "string" },
        authType: { type: "string", enum: ["key", "password"] },
        keyPath: { type: "string", description: "Path to private key (for key auth)" },
        modelBaseUrl: {
          type: "string",
          description: "URL of the model API on the server, e.g. http://127.0.0.1:11434 for Ollama",
        },
      },
      required: ["label", "host", "user", "authType"],
    },
  },
];
