import { json } from "../../_lib/response";
import { db, conversations, toConversationRow, fromConversationRow } from "../../_lib/db";
import { desc } from "drizzle-orm";

export async function GET() {
  const rows = await db.select().from(conversations).orderBy(desc(conversations.createdAt));
  const list = rows.map(fromConversationRow);
  return json(list);
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const title = typeof payload.title === "string" ? payload.title.trim() || null : null;
  const id = crypto.randomUUID();
  await db
    .insert(conversations)
    .values(
      toConversationRow({
        id,
        title,
        rating: null,
        note: null,
        summary: null,
        lastUsedProvider: null,
        lastUsedModel: null,
        createdAt: Date.now(),
      })
    )
    .run();
  return json({ id, title });
}
