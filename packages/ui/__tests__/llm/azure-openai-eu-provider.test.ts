import { afterEach, describe, expect, it, vi } from "vitest";
import { azureOpenAiEuProvider, type LLMRequest } from "@agentron-studio/runtime";

describe("azure_openai_eu provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AZURE_OPENAI_EU_ENDPOINT;
    delete process.env.AZURE_OPENAI_EU_API_KEY;
  });

  it("requires endpoint and api key when not in env", async () => {
    const request: LLMRequest = { messages: [{ role: "user", content: "hi" }] };
    await expect(
      azureOpenAiEuProvider.chat({ provider: "azure_openai_eu", model: "gpt-6.1-sol" }, request)
    ).rejects.toThrow(/endpoint/i);

    await expect(
      azureOpenAiEuProvider.chat(
        {
          provider: "azure_openai_eu",
          model: "gpt-6.1-sol",
          endpoint: "https://example.openai.azure.com",
        },
        request
      )
    ).rejects.toThrow(/API key/i);
  });

  it("calls Azure deployment chat completions URL with api-key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "chatcmpl-test",
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const request: LLMRequest = { messages: [{ role: "user", content: "hi" }] };
    const response = await azureOpenAiEuProvider.chat(
      {
        provider: "azure_openai_eu",
        model: "gpt-6-luna",
        endpoint: "https://my-resource.openai.azure.com",
        apiKey: "secret-key",
      },
      request
    );

    expect(response.content).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://my-resource.openai.azure.com/openai/deployments/gpt-6-luna/chat/completions?api-version=2024-08-01-preview"
    );
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "api-key": "secret-key",
    });
    const body = JSON.parse(String(init.body));
    expect(body.model).toBeUndefined();
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });
});
