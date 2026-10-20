import { describe, expect, it } from "vitest";
import { GET } from "../../app/api/llm/si-tier-presets/route";

describe("GET /api/llm/si-tier-presets", () => {
  it("returns azure_openai_eu SI presets", async () => {
    const res = await GET();
    const data = await res.json();
    expect(data.provider).toBe("azure_openai_eu");
    expect(data.endpointEnvVar).toBe("AZURE_OPENAI_EU_ENDPOINT");
    expect(data.apiKeyEnvVar).toBe("AZURE_OPENAI_EU_API_KEY");
    expect(Array.isArray(data.presets)).toBe(true);
    expect(data.presets.length).toBe(3);
  });
});
