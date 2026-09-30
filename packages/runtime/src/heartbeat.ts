import type { Sql } from "@decisionloop/storage-sql/connection";
export function workerHeartbeat(sql: Sql, workerId: string) {
  return {
    everyMs: 10000,
    run: async () => {
      await sql`INSERT INTO worker_heartbeats (worker_id, seen_at) VALUES (${workerId}, now()) ON CONFLICT (worker_id) DO UPDATE SET seen_at = now()`;
      await sql`DELETE FROM worker_heartbeats WHERE seen_at < now() - interval '1 day'`;
      await sql`DELETE FROM request_limits WHERE window_start < now() - interval '1 day'`;
    },
  };
}
