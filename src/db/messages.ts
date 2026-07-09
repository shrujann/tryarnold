import { dbRun, utcNow } from "./client";

export async function logMessage(
  db: D1Database,
  userId: number,
  direction: "in" | "out",
  content: string | null,
  channel: string,
  kind = "text",
): Promise<void> {
  await dbRun(
    db,
    "INSERT INTO messages (user_id, ts, direction, channel, content, kind) VALUES (?, ?, ?, ?, ?, ?)",
    userId,
    utcNow(),
    direction,
    channel,
    content,
    kind,
  );
}

export async function getRecentMessages(
  db: D1Database,
  userId: number,
  limit = 8,
): Promise<Record<string, unknown>[]> {
  const { dbAll } = await import("./client");
  return dbAll(
    db,
    "SELECT direction, content FROM messages WHERE user_id = ? ORDER BY ts DESC LIMIT ?",
    userId,
    limit,
  );
}
