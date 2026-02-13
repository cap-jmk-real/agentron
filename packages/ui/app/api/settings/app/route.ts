import { json } from "../../_lib/response";
import { getAppSettings, updateAppSettings } from "../../_lib/app-settings";
import { logApiError } from "../../_lib/api-logger";

export const runtime = "nodejs";

/** GET returns general app settings (e.g. max file upload size). */
export async function GET() {
  try {
    const settings = getAppSettings();
    return json(settings);
  } catch (e) {
    logApiError("/api/settings/app", "GET", e);
    const message = e instanceof Error ? e.message : "Failed to load settings";
    return json({ error: message }, { status: 500 });
  }
}

/** PATCH updates general app settings. Body: { maxFileUploadBytes?: number } (bytes). */
export async function PATCH(request: Request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const updates: { maxFileUploadBytes?: number } = {};
    if (payload.maxFileUploadBytes !== undefined) {
      const v = Number(payload.maxFileUploadBytes);
      if (!Number.isNaN(v)) updates.maxFileUploadBytes = v;
    }
    const settings = updateAppSettings(updates);
    return json(settings);
  } catch (e) {
    logApiError("/api/settings/app", "PATCH", e);
    const message = e instanceof Error ? e.message : "Failed to update settings";
    return json({ error: message }, { status: 500 });
  }
}
