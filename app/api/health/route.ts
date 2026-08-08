import { NextResponse } from "next/server";
import { sql } from "@/db/client";
import { mcpConfigured } from "@/lib/mcp/cockroachClient";

/** Basic liveness/readiness probe: confirms CockroachDB connectivity and
 * reports which optional integrations (embeddings, MCP) are configured. */
export async function GET() {
  const checks: Record<string, boolean | string> = {};
  let dbOk = true;

  try {
    const start = Date.now();
    await sql`SELECT 1`;
    checks.database = `ok (${Date.now() - start}ms)`;
  } catch (err) {
    dbOk = false;
    checks.database = `error: ${err instanceof Error ? err.message : String(err)}`;
  }

  checks.anthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  checks.voyageEmbeddings = Boolean(process.env.VOYAGE_API_KEY);
  checks.s3 = Boolean(process.env.S3_BUCKET_NAME);
  checks.cockroachMcp = mcpConfigured();

  return NextResponse.json(
    { status: dbOk ? "ok" : "degraded", checks, timestamp: new Date().toISOString() },
    { status: dbOk ? 200 : 503 },
  );
}
