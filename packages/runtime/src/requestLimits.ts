import crypto from "node:crypto";
import type { Sql } from "@decisionloop/storage-sql/connection";
export async function takeRequestLimit(
  sql: Sql,
  key: string,
  limit: number,
  seconds = 60,
): Promise<boolean> {
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  const start = new Date(
    Math.floor(Date.now() / (seconds * 1000)) * seconds * 1000,
  );
  const [row] = await sql`
    INSERT INTO request_limits (key_hash, window_start, count) VALUES (${hash}, ${start}, 1)
    ON CONFLICT (key_hash) DO UPDATE SET
      count = CASE WHEN request_limits.window_start = ${start} THEN request_limits.count + 1 ELSE 1 END,
      window_start = ${start}
    RETURNING count
  `;
  return Number(row?.count) <= limit;
}
