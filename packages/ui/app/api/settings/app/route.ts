import { json } from "../../_lib/response";
import { getAppSettings, updateAppSettings } from "../../_lib/app-settings";

export const runtime = "nodejs";

/** GET returns general app settings (e.g. max file upload size). */
export async function GET() {
  const settings = getAppSettings();
  return json(settings);
}

/** PATCH updates general app settings. Body: { maxFileUploadBytes?: number } (bytes). */
export async function PATCH(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const updates: { maxFileUploadBytes?: number } = {};
  if (payload.maxFileUploadBytes !== undefined) {
    const v = Number(payload.maxFileUploadBytes);
    if (!Number.isNaN(v)) updates.maxFileUploadBytes = v;
  }
  const settings = updateAppSettings(updates);
  return json(settings);
}
