export type DbRow = Record<string, unknown>;

export async function dbAll(
  db: D1Database,
  sql: string,
  ...binds: unknown[]
): Promise<DbRow[]> {
  const stmt = db.prepare(sql);
  const result = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
  return (result.results ?? []) as DbRow[];
}

export async function dbFirst(
  db: D1Database,
  sql: string,
  ...binds: unknown[]
): Promise<DbRow | null> {
  const rows = await dbAll(db, sql, ...binds);
  return rows[0] ?? null;
}

export async function dbRun(
  db: D1Database,
  sql: string,
  ...binds: unknown[]
): Promise<number> {
  const stmt = db.prepare(sql);
  const result = binds.length
    ? await stmt.bind(...binds).run()
    : await stmt.run();
  return Number(result.meta?.changes ?? 0);
}

export function utcNow(): string {
  return new Date().toISOString();
}

export function startOfDayInTimezone(timezone: string, referenceDate = new Date()): string {
  const tz = timezone || "UTC";
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(referenceDate);

  const [year, month, day] = dateParts.split("-").map(Number);
  let low = Date.UTC(year, month - 1, day - 1);
  let high = Date.UTC(year, month - 1, day + 1);

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(
      new Date(mid),
    );
    if (localDate < dateParts) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return new Date(low).toISOString();
}
