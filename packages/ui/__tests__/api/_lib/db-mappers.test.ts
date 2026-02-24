import { describe, it, expect } from "vitest";
import {
  parseJson,
  toReminderRow,
  fromReminderRow,
  toAgentRow,
  fromAgentRow,
  toWorkflowRow,
  fromWorkflowRow,
  toToolRow,
  fromToolRow,
  toChatMessageRow,
  fromChatMessageRow,
  toChatAssistantSettingsRow,
  fromChatAssistantSettingsRow,
  fromSandboxSiteBindingRow,
  toFileRow,
  fromFileRow,
  toTokenUsageRow,
  fromAssistantMemoryRow,
  toSandboxRow,
  fromSandboxRow,
  toRemoteServerRow,
  fromRemoteServerRow,
} from "../../../app/api/_lib/db-mappers";
import type { Reminder, RemoteServer } from "../../../app/api/_lib/db-mappers";
import type {
  Agent,
  Workflow,
  ToolDefinition,
  ChatAssistantSettings,
  FileEntry,
  Sandbox,
} from "@agentron-studio/core";
import {
  agents,
  workflows,
  tools,
  chatMessages,
  chatAssistantSettings,
  reminders,
  sandboxSiteBindings,
  files,
  assistantMemory,
  sandboxes,
  remoteServers,
} from "@agentron-studio/core";

describe("db-mappers", () => {
  describe("parseJson", () => {
    it("returns fallback when value is null or empty", () => {
      expect(parseJson(null, "default")).toBe("default");
      expect(parseJson(undefined, 42)).toBe(42);
      expect(parseJson("")).toBeUndefined();
    });

    it("returns parsed value for valid JSON", () => {
      expect(parseJson('{"a":1}', {})).toEqual({ a: 1 });
      expect(parseJson("[1,2]", [])).toEqual([1, 2]);
    });

    it("returns fallback when JSON is invalid", () => {
      expect(parseJson("not json", "fallback")).toBe("fallback");
      expect(parseJson("{ broken", undefined)).toBeUndefined();
    });
  });

  describe("Reminder mappers", () => {
    it("toReminderRow and fromReminderRow roundtrip", () => {
      const r: Reminder = {
        id: "rem-1",
        runAt: 1000,
        message: "msg",
        conversationId: "conv-1",
        taskType: "message",
        status: "pending",
        createdAt: 2000,
        firedAt: null,
      };
      const row = toReminderRow(r);
      expect(row.conversationId).toBe("conv-1");
      expect(row.firedAt).toBeNull();
      const out = fromReminderRow(row as typeof reminders.$inferSelect);
      expect(out.id).toBe(r.id);
      expect(out.conversationId).toBe("conv-1");
      expect(out.taskType).toBe("message");
      expect(out.firedAt).toBeUndefined();
    });

    it("fromReminderRow uses defaults for null taskType", () => {
      const row = {
        id: "x",
        runAt: 0,
        message: "",
        conversationId: null,
        taskType: null,
        status: "pending",
        createdAt: 0,
        firedAt: null,
      };
      const out = fromReminderRow(row as unknown as typeof reminders.$inferSelect);
      expect(out.taskType).toBe("message");
    });
  });

  describe("Agent mappers", () => {
    it("toAgentRow includes definition when present", () => {
      const agent = {
        id: "a1",
        name: "A",
        description: "d",
        kind: "workflow" as const,
        type: "openai" as const,
        protocol: "openai" as const,
        endpoint: "http://x",
        agentKey: null,
        capabilities: [],
        scopes: [],
        definition: { foo: 1 },
      };
      const row = toAgentRow(agent as unknown as Agent);
      expect(JSON.parse(row.definition!)).toEqual({ foo: 1 });
    });

    it("toAgentRow omits definition when null", () => {
      const agent = {
        id: "a1",
        name: "A",
        description: null,
        kind: "workflow" as const,
        type: "openai" as const,
        protocol: "openai" as const,
        endpoint: null,
        agentKey: null,
        capabilities: [],
        scopes: [],
      };
      const row = toAgentRow(agent as unknown as Agent);
      expect(row.definition).toBeNull();
    });

    it("fromAgentRow sets definition only when parsed value is object", () => {
      const row = {
        id: "a1",
        name: "A",
        description: null,
        kind: "workflow",
        type: "openai",
        protocol: "openai",
        endpoint: null,
        agentKey: null,
        capabilities: "[]",
        scopes: "[]",
        llmConfig: null,
        definition: '{"x":1}',
      };
      const agent = fromAgentRow(row as unknown as typeof agents.$inferSelect);
      expect((agent as Agent & { definition?: unknown }).definition).toEqual({ x: 1 });
    });

    it("fromAgentRow does not set definition when parsed value is not object", () => {
      const row = {
        id: "a1",
        name: "A",
        description: null,
        kind: "workflow",
        type: "openai",
        protocol: "openai",
        endpoint: null,
        agentKey: null,
        capabilities: "[]",
        scopes: "[]",
        llmConfig: null,
        definition: "42",
      };
      const agent = fromAgentRow(row as unknown as typeof agents.$inferSelect);
      expect((agent as Agent & { definition?: unknown }).definition).toBeUndefined();
    });
  });

  describe("Workflow mappers", () => {
    it("toWorkflowRow serializes branches and executionOrder when present", () => {
      const wf = {
        id: "w1",
        name: "W",
        description: null,
        nodes: [],
        edges: [],
        executionMode: "manual" as const,
        schedule: null,
        branches: [{ id: "b1", name: "main" }],
        executionOrder: ["n1"],
      };
      const row = toWorkflowRow(wf as unknown as Workflow);
      expect(row.branches).not.toBeNull();
      expect(row.executionOrder).not.toBeNull();
    });

    it("toWorkflowRow omits executionOrder when empty", () => {
      const wf = {
        id: "w1",
        name: "W",
        description: null,
        nodes: [],
        edges: [],
        executionMode: "manual" as const,
        schedule: null,
        executionOrder: [],
      };
      const row = toWorkflowRow(wf as unknown as Workflow);
      expect(row.executionOrder).toBeNull();
    });

    it("fromWorkflowRow parses branches and executionOrder", () => {
      const row = {
        id: "w1",
        name: "W",
        description: null,
        nodes: "[]",
        edges: "[]",
        executionMode: "manual",
        schedule: null,
        maxRounds: null,
        turnInstruction: null,
        branches: '[{"id":"b1"}]',
        executionOrder: '["n1"]',
        createdAt: 0,
      };
      const wf = fromWorkflowRow(row as unknown as typeof workflows.$inferSelect);
      expect(wf.branches).toEqual([{ id: "b1" }]);
      expect(wf.executionOrder).toEqual(["n1"]);
    });
  });

  describe("Tool mappers", () => {
    it("toToolRow serializes inputSchema and outputSchema when present", () => {
      const tool = {
        id: "t1",
        name: "T",
        protocol: "openai" as const,
        config: {},
        inputSchema: { type: "object" },
        outputSchema: { type: "string" },
      };
      const row = toToolRow(tool as unknown as ToolDefinition);
      expect(row.inputSchema).not.toBeNull();
      expect(row.outputSchema).not.toBeNull();
    });

    it("fromToolRow returns undefined for null inputSchema", () => {
      const row = {
        id: "t1",
        name: "T",
        protocol: "openai",
        config: "{}",
        inputSchema: null,
        outputSchema: null,
      };
      const tool = fromToolRow(row as typeof tools.$inferSelect);
      expect(tool.inputSchema).toBeUndefined();
      expect(tool.outputSchema).toBeUndefined();
    });
  });

  describe("ChatMessage and normalizeToolCalls", () => {
    it("fromChatMessageRow returns undefined toolCalls when parsed empty array", () => {
      const row = {
        id: "m1",
        conversationId: "c1",
        role: "user",
        content: "hi",
        toolCalls: "[]",
        llmTrace: null,
        rephrasedPrompt: null,
        createdAt: 0,
      };
      const msg = fromChatMessageRow(row as typeof chatMessages.$inferSelect);
      expect(msg.toolCalls).toBeUndefined();
    });

    it("fromChatMessageRow normalizes toolCalls with args and uses arguments when no args", () => {
      const row = {
        id: "m1",
        conversationId: "c1",
        role: "assistant",
        content: "",
        toolCalls: JSON.stringify([
          { id: "tc1", name: "foo", args: { x: 1 } },
          { name: "bar", arguments: { y: 2 } },
        ]),
        llmTrace: null,
        rephrasedPrompt: null,
        createdAt: 0,
      };
      const msg = fromChatMessageRow(row as typeof chatMessages.$inferSelect);
      expect(msg.toolCalls).toHaveLength(2);
      expect(msg.toolCalls![0].id).toBe("tc1");
      expect(msg.toolCalls![0].arguments).toEqual({ x: 1 });
      expect(msg.toolCalls![1].arguments).toEqual({ y: 2 });
    });

    it("fromChatMessageRow filters out tool calls with empty name", () => {
      const row = {
        id: "m1",
        conversationId: "c1",
        role: "assistant",
        content: "",
        toolCalls: JSON.stringify([{ name: "" }, { name: "ok" }]),
        llmTrace: null,
        rephrasedPrompt: null,
        createdAt: 0,
      };
      const msg = fromChatMessageRow(row as typeof chatMessages.$inferSelect);
      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.toolCalls![0].name).toBe("ok");
    });

    it("fromChatMessageRow returns undefined rephrasedPrompt when blank", () => {
      const row = {
        id: "m1",
        conversationId: "c1",
        role: "user",
        content: "hi",
        toolCalls: null,
        llmTrace: null,
        rephrasedPrompt: "  ",
        createdAt: 0,
      };
      const msg = fromChatMessageRow(row as typeof chatMessages.$inferSelect);
      expect(msg.rephrasedPrompt).toBeUndefined();
    });

    it("fromChatMessageRow returns rephrasedPrompt when non-empty string", () => {
      const row = {
        id: "m1",
        conversationId: "c1",
        role: "user",
        content: "hi",
        toolCalls: null,
        llmTrace: null,
        rephrasedPrompt: " rephrased ",
        createdAt: 0,
      };
      const msg = fromChatMessageRow(row as typeof chatMessages.$inferSelect);
      expect(msg.rephrasedPrompt).toBe(" rephrased ");
    });

    it("normalizeToolCalls uses empty object when args not object", () => {
      const row = {
        id: "m1",
        conversationId: "c1",
        role: "assistant",
        content: "",
        toolCalls: JSON.stringify([{ name: "t", args: "not-object" }]),
        llmTrace: null,
        rephrasedPrompt: null,
        createdAt: 0,
      };
      const msg = fromChatMessageRow(row as typeof chatMessages.$inferSelect);
      expect(msg.toolCalls![0].arguments).toEqual({});
    });

    it("normalizeToolCalls uses empty object when args is null", () => {
      const row = {
        id: "m1",
        conversationId: "c1",
        role: "assistant",
        content: "",
        toolCalls: JSON.stringify([{ name: "t", args: null }]),
        llmTrace: null,
        rephrasedPrompt: null,
        createdAt: 0,
      };
      const msg = fromChatMessageRow(row as typeof chatMessages.$inferSelect);
      expect(msg.toolCalls![0].arguments).toEqual({});
    });

    it("fromChatMessageRow returns undefined rephrasedPrompt when not a string", () => {
      const row = {
        id: "m1",
        conversationId: "c1",
        role: "user",
        content: "hi",
        toolCalls: null,
        llmTrace: null,
        rephrasedPrompt: 123 as unknown as string | null,
        createdAt: 0,
      };
      const msg = fromChatMessageRow(row as typeof chatMessages.$inferSelect);
      expect(msg.rephrasedPrompt).toBeUndefined();
    });
  });

  describe("ChatAssistantSettings mappers", () => {
    it("toChatAssistantSettingsRow stringifies arrays and temperature/feedbackMinScore", () => {
      const s = {
        id: "s1",
        customSystemPrompt: null,
        contextAgentIds: ["a1"],
        contextWorkflowIds: null,
        contextToolIds: null,
        recentSummariesCount: null,
        temperature: 0.7,
        historyCompressAfter: null,
        historyKeepRecent: null,
        plannerRecentMessages: null,
        ragRetrieveLimit: null,
        feedbackLastN: null,
        feedbackRetrieveCap: null,
        feedbackMinScore: 0.5,
        updatedAt: 0,
      };
      const row = toChatAssistantSettingsRow(s as ChatAssistantSettings);
      expect(row.contextAgentIds).toBe('["a1"]');
      expect(row.temperature).toBe("0.7");
      expect(row.feedbackMinScore).toBe("0.5");
    });

    it("toChatAssistantSettingsRow stringifies contextWorkflowIds and contextToolIds when set", () => {
      const s = {
        id: "s2",
        customSystemPrompt: null,
        contextAgentIds: null,
        contextWorkflowIds: ["w1", "w2"],
        contextToolIds: ["t1"],
        recentSummariesCount: null,
        temperature: null,
        historyCompressAfter: null,
        historyKeepRecent: null,
        plannerRecentMessages: null,
        ragRetrieveLimit: null,
        feedbackLastN: null,
        feedbackRetrieveCap: null,
        feedbackMinScore: null,
        updatedAt: 0,
      };
      const row = toChatAssistantSettingsRow(s as ChatAssistantSettings);
      expect(row.contextWorkflowIds).toBe('["w1","w2"]');
      expect(row.contextToolIds).toBe('["t1"]');
      expect(row.temperature).toBeNull();
      expect(row.feedbackMinScore).toBeNull();
    });

    it("fromChatAssistantSettingsRow parses temperature and feedbackMinScore", () => {
      const row = {
        id: "s1",
        customSystemPrompt: null,
        contextAgentIds: "[]",
        contextWorkflowIds: null,
        contextToolIds: null,
        recentSummariesCount: null,
        temperature: "0.8",
        historyCompressAfter: null,
        historyKeepRecent: null,
        plannerRecentMessages: null,
        ragRetrieveLimit: null,
        feedbackLastN: null,
        feedbackRetrieveCap: null,
        feedbackMinScore: "0.6",
        updatedAt: 0,
      };
      const s = fromChatAssistantSettingsRow(row as typeof chatAssistantSettings.$inferSelect);
      expect(s.temperature).toBe(0.8);
      expect(s.feedbackMinScore).toBe(0.6);
    });
  });

  describe("SandboxSiteBinding mappers", () => {
    it("fromSandboxSiteBindingRow maps row to binding", () => {
      const row = {
        id: "bind-1",
        sandboxId: "sb-1",
        host: "localhost",
        containerPort: 8080,
        hostPort: 9090,
        createdAt: 1000,
      };
      const out = fromSandboxSiteBindingRow(row as typeof sandboxSiteBindings.$inferSelect);
      expect(out.id).toBe("bind-1");
      expect(out.sandboxId).toBe("sb-1");
      expect(out.hostPort).toBe(9090);
    });
  });

  describe("File mappers", () => {
    it("toFileRow and fromFileRow roundtrip", () => {
      const f: FileEntry = {
        id: "file-1",
        name: "doc.pdf",
        mimeType: "application/pdf",
        size: 1024,
        path: "/data/doc.pdf",
        createdAt: 2000,
      };
      const row = toFileRow(f);
      expect(row.id).toBe("file-1");
      expect(row.name).toBe("doc.pdf");
      const out = fromFileRow(row as typeof files.$inferSelect);
      expect(out).toEqual(f);
    });
  });

  describe("TokenUsage mappers", () => {
    it("toTokenUsageRow maps null executionId, agentId, workflowId, estimatedCost to null", () => {
      const u = {
        id: "tu-1",
        executionId: undefined,
        agentId: null,
        workflowId: undefined,
        provider: "openai",
        model: "gpt-4",
        promptTokens: 10,
        completionTokens: 20,
        estimatedCost: null,
      };
      const row = toTokenUsageRow(u);
      expect(row.executionId).toBeNull();
      expect(row.agentId).toBeNull();
      expect(row.workflowId).toBeNull();
      expect(row.estimatedCost).toBeNull();
      expect(row.provider).toBe("openai");
    });
  });

  describe("AssistantMemory mappers", () => {
    it("fromAssistantMemoryRow maps row with null key", () => {
      const row = {
        id: "mem-1",
        key: null,
        content: "some content",
        createdAt: 1000,
      };
      const out = fromAssistantMemoryRow(row as typeof assistantMemory.$inferSelect);
      expect(out.id).toBe("mem-1");
      expect(out.key).toBeNull();
      expect(out.content).toBe("some content");
    });
  });

  describe("Sandbox mappers", () => {
    it("toSandboxRow uses empty object when config undefined", () => {
      const s = {
        id: "sb-1",
        name: "test",
        image: "img",
        status: "running",
        containerId: "c1",
        config: undefined,
        createdAt: 1000,
      } as unknown as Sandbox;
      const row = toSandboxRow(s);
      expect(row.config).toBe("{}");
    });

    it("toSandboxRow stringifies config when provided", () => {
      const s = {
        id: "sb-2",
        name: "test",
        image: "img",
        status: "running",
        containerId: null,
        config: { env: "prod" },
        createdAt: 1000,
      } as unknown as Sandbox;
      const row = toSandboxRow(s);
      expect(row.config).toBe(JSON.stringify({ env: "prod" }));
    });

    it("fromSandboxRow parses config and uses empty object when null", () => {
      const row = {
        id: "sb-1",
        name: "n",
        image: "i",
        status: "running",
        containerId: null,
        config: null,
        createdAt: 1000,
      };
      const out = fromSandboxRow(row as unknown as typeof sandboxes.$inferSelect);
      expect(out.config).toEqual({});
    });

    it("fromSandboxRow uses empty object when config is empty string (parseJson returns undefined)", () => {
      const row = {
        id: "sb-2",
        name: "n",
        image: "i",
        status: "running",
        containerId: null,
        config: "",
        createdAt: 1000,
      };
      const out = fromSandboxRow(row as unknown as typeof sandboxes.$inferSelect);
      expect(out.config).toEqual({});
    });

    it("fromSandboxRow parses config JSON to object", () => {
      const row = {
        id: "sb-3",
        name: "n",
        image: "i",
        status: "running",
        containerId: null,
        config: '{"key":"value"}',
        createdAt: 1000,
      };
      const out = fromSandboxRow(row as unknown as typeof sandboxes.$inferSelect);
      expect(out.config).toEqual({ key: "value" });
    });
  });

  describe("RemoteServer mappers", () => {
    it("toRemoteServerRow uses null for keyPath and modelBaseUrl and Date.now() for createdAt when undefined", () => {
      const s: RemoteServer = {
        id: "rs-1",
        label: "l",
        host: "h",
        port: 22,
        user: "u",
        authType: "key",
        keyPath: undefined,
        modelBaseUrl: undefined,
        createdAt: undefined,
      };
      const row = toRemoteServerRow(s);
      expect(row.keyPath).toBeNull();
      expect(row.modelBaseUrl).toBeNull();
      expect(typeof row.createdAt).toBe("number");
    });

    it("fromRemoteServerRow maps null keyPath and modelBaseUrl to undefined", () => {
      const row = {
        id: "rs-1",
        label: "l",
        host: "h",
        port: 22,
        user: "u",
        authType: "key",
        keyPath: null,
        modelBaseUrl: null,
        createdAt: 1000,
      };
      const out = fromRemoteServerRow(row as typeof remoteServers.$inferSelect);
      expect(out.keyPath).toBeUndefined();
      expect(out.modelBaseUrl).toBeUndefined();
    });
  });
});
