import { json } from "../../_lib/response";
import { db, modelPricing, toModelPricingRow, fromModelPricingRow } from "../../_lib/db";
import { eq } from "drizzle-orm";
import { DEFAULT_MODEL_PRICING } from "@agentron-studio/runtime";

export const runtime = "nodejs";

export async function GET() {
  const rows = await db.select().from(modelPricing);
  const custom = rows.map(fromModelPricingRow);

  // Merge defaults with custom overrides
  const customMap = new Map(custom.map((c) => [c.modelPattern, c]));

  const merged = Object.entries(DEFAULT_MODEL_PRICING).map(([model, pricing]) => {
    const override = customMap.get(model);
    if (override) {
      customMap.delete(model);
      return { id: override.id, modelPattern: model, inputCostPerM: override.inputCostPerM, outputCostPerM: override.outputCostPerM, isCustom: true };
    }
    return { id: null, modelPattern: model, inputCostPerM: pricing.input, outputCostPerM: pricing.output, isCustom: false };
  });

  // Add remaining custom entries not in defaults
  for (const c of customMap.values()) {
    merged.push({ id: c.id, modelPattern: c.modelPattern, inputCostPerM: c.inputCostPerM, outputCostPerM: c.outputCostPerM, isCustom: true });
  }

  return json(merged);
}

export async function PUT(request: Request) {
  const payload = await request.json();
  const { modelPattern, inputCostPerM, outputCostPerM } = payload as {
    modelPattern: string;
    inputCostPerM: number;
    outputCostPerM: number;
  };

  if (!modelPattern) return json({ error: "modelPattern required" }, { status: 400 });

  // Upsert: check if custom entry exists
  const existing = await db.select().from(modelPricing);
  const match = existing.find((r) => r.modelPattern === modelPattern);

  if (match) {
    await db.update(modelPricing)
      .set({ inputCostPerM: String(inputCostPerM), outputCostPerM: String(outputCostPerM), updatedAt: Date.now() })
      .where(eq(modelPricing.id, match.id))
      .run();
    return json({ id: match.id, modelPattern, inputCostPerM, outputCostPerM });
  }

  const id = crypto.randomUUID();
  await db.insert(modelPricing).values(toModelPricingRow({ id, modelPattern, inputCostPerM, outputCostPerM })).run();
  return json({ id, modelPattern, inputCostPerM, outputCostPerM }, { status: 201 });
}
