import { afterEach, describe, expect, it } from "vitest";
import {
  getAzureOpenAiEuSiPresets,
  resolveAzureOpenAiEuSiDeployment,
} from "@agentron-studio/runtime";

const ENV_KEYS = [
  "AZURE_OPENAI_EU_SI_DEPLOYMENT_HARDEST",
  "AZURE_OPENAI_EU_SI_DEPLOYMENT_HARD",
  "AZURE_OPENAI_EU_SI_DEPLOYMENT_SMALL",
] as const;

describe("Azure OpenAI EU SI tier presets", () => {
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("exposes three sail.black SI tiers with default deployment names", () => {
    const presets = getAzureOpenAiEuSiPresets();
    expect(presets).toHaveLength(3);
    expect(presets.map((p) => p.tier)).toEqual(["hardest", "hard", "small"]);
    expect(presets[0].deployment).toBe("gpt-6.1-sol");
    expect(presets[1].deployment).toBe("deepseek-v4.1-flash");
    expect(presets[2].deployment).toBe("gpt-6-luna");
    expect(presets[0].label).toContain("SI hardest");
    expect(presets[1].label).toContain("SI hard");
    expect(presets[2].label).toContain("SI small");
  });

  it("allows env override of deployment names per tier", () => {
    process.env.AZURE_OPENAI_EU_SI_DEPLOYMENT_HARDEST = "my-gpt-6-1-sol";
    process.env.AZURE_OPENAI_EU_SI_DEPLOYMENT_HARD = "my-deepseek";
    process.env.AZURE_OPENAI_EU_SI_DEPLOYMENT_SMALL = "my-luna";

    expect(resolveAzureOpenAiEuSiDeployment("hardest")).toBe("my-gpt-6-1-sol");
    expect(resolveAzureOpenAiEuSiDeployment("hard")).toBe("my-deepseek");
    expect(resolveAzureOpenAiEuSiDeployment("small")).toBe("my-luna");

    const presets = getAzureOpenAiEuSiPresets();
    expect(presets.find((p) => p.tier === "hard")?.deployment).toBe("my-deepseek");
  });
});
