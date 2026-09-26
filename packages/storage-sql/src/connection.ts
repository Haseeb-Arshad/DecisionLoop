import postgres from "postgres";
import { getCockroachSslOptions } from "./ssl";

export type Sql = ReturnType<typeof postgres>;
export type Dialect = "cockroach" | "postgres";

/**
 * True when the URL points at this machine or explicitly disables TLS —
 * i.e. an embedded PGlite server or a local PostgreSQL. CockroachDB Cloud
 * certificates must never be forced onto those connections.
 */
export function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.searchParams.get("sslmode") === "disable") return true;
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

export function createSql(
  url: string,
  opts: { max?: number; applicationName?: string } = {},
): Sql {
  const local = isLocalUrl(url);
  return postgres(url, {
    ssl: local ? false : getCockroachSslOptions(),
    max: opts.max ?? Number(process.env.DATABASE_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
    // CockroachDB Serverless connection pooling doesn't play well with
    // prepared statements; the embedded server doesn't need them either.
    prepare: false,
    onnotice: () => {},
    connection: opts.applicationName ? { application_name: opts.applicationName } : undefined,
  });
}

export async function detectDialect(sql: Sql): Promise<Dialect> {
  const [row] = await sql`SELECT version() AS v`;
  return String(row?.v ?? "").includes("CockroachDB") ? "cockroach" : "postgres";
}
