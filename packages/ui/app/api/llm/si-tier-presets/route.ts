import {
  AZURE_OPENAI_EU_API_KEY_ENV,
  AZURE_OPENAI_EU_ENDPOINT_ENV,
  getAzureOpenAiEuSiPresets,
} from "@agentron-studio/runtime";
import { json } from "../../_lib/response";

export const runtime = "nodejs";

/** Optional sail.black SI tier presets for Azure OpenAI (EU Data Zone). */
export async function GET() {
  return json({
    provider: "azure_openai_eu",
    endpointEnvVar: AZURE_OPENAI_EU_ENDPOINT_ENV,
    apiKeyEnvVar: AZURE_OPENAI_EU_API_KEY_ENV,
    presets: getAzureOpenAiEuSiPresets(),
  });
}
