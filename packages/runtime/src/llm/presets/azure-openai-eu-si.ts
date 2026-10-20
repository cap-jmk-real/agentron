/**
 * Optional sail.black SI tier presets for Azure OpenAI (EU Data Zone).
 * Not applied automatically — users opt in via Settings → LLM Providers.
 */

export type AzureOpenAiEuSiTier = "hardest" | "hard" | "small";

export const AZURE_OPENAI_EU_ENDPOINT_ENV = "AZURE_OPENAI_EU_ENDPOINT";
export const AZURE_OPENAI_EU_API_KEY_ENV = "AZURE_OPENAI_EU_API_KEY";
export const AZURE_OPENAI_EU_API_VERSION_ENV = "AZURE_OPENAI_EU_API_VERSION";

const DEPLOYMENT_ENV: Record<AzureOpenAiEuSiTier, string> = {
  hardest: "AZURE_OPENAI_EU_SI_DEPLOYMENT_HARDEST",
  hard: "AZURE_OPENAI_EU_SI_DEPLOYMENT_HARD",
  small: "AZURE_OPENAI_EU_SI_DEPLOYMENT_SMALL",
};

const DEFAULT_DEPLOYMENTS: Record<AzureOpenAiEuSiTier, string> = {
  hardest: "gpt-6.1-sol",
  hard: "deepseek-v4.1-flash",
  small: "gpt-6-luna",
};

/** Catalog / pricing model id per tier (sail.black model family). */
const CATALOG_MODEL_ID: Record<AzureOpenAiEuSiTier, string> = {
  hardest: "gpt-6.1-sol",
  hard: "deepseek-v4.1-flash",
  small: "gpt-6-luna",
};

export type AzureOpenAiEuSiPreset = {
  id: string;
  tier: AzureOpenAiEuSiTier;
  /** User-facing label; includes SI tier name. */
  label: string;
  /** Azure deployment name (env-overridable). */
  deployment: string;
  /** Model id used for catalog and pricing lookup. */
  catalogModelId: string;
};

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const v = process.env[name];
  return v?.trim() ? v.trim() : undefined;
}

/** Resolve Azure deployment name for an SI tier (env overrides default sail.black name). */
export function resolveAzureOpenAiEuSiDeployment(tier: AzureOpenAiEuSiTier): string {
  return readEnv(DEPLOYMENT_ENV[tier]) ?? DEFAULT_DEPLOYMENTS[tier];
}

export function resolveAzureOpenAiEuEndpoint(): string | undefined {
  return readEnv(AZURE_OPENAI_EU_ENDPOINT_ENV);
}

export function resolveAzureOpenAiEuApiKey(): string | undefined {
  return readEnv(AZURE_OPENAI_EU_API_KEY_ENV);
}

export function resolveAzureOpenAiEuApiVersion(): string {
  return readEnv(AZURE_OPENAI_EU_API_VERSION_ENV) ?? "2024-08-01-preview";
}

const TIER_LABELS: Record<AzureOpenAiEuSiTier, string> = {
  hardest: "SI hardest",
  hard: "SI hard",
  small: "SI small",
};

/** Built-in SI tier presets (deployment names resolved at call time). */
export function getAzureOpenAiEuSiPresets(): AzureOpenAiEuSiPreset[] {
  const tiers: AzureOpenAiEuSiTier[] = ["hardest", "hard", "small"];
  return tiers.map((tier) => {
    const deployment = resolveAzureOpenAiEuSiDeployment(tier);
    const catalogModelId = CATALOG_MODEL_ID[tier];
    return {
      id: `azure-openai-eu-si-${tier}`,
      tier,
      label: `${TIER_LABELS[tier]} (${catalogModelId})`,
      deployment,
      catalogModelId,
    };
  });
}
