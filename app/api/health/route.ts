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

  // AWS credentials configured is necessary but not sufficient — Bedrock
  // model access is opt-in per account/region in the console, so this can't
  // distinguish "reachable" from "will actually work." A real check would
  // need a live InvokeModel call, which isn't worth the cost on a health
  // probe hit repeatedly by uptime monitors.
  checks.awsConfigured = Boolean(process.env.AWS_REGION);
  checks.bedrockReasoningModel = process.env.BEDROCK_REASONING_MODEL_ID ?? "(using default)";
  checks.bedrockEmbeddingModel = process.env.BEDROCK_EMBEDDING_MODEL_ID ?? "(using default)";
  checks.s3 = Boolean(process.env.S3_BUCKET_NAME);
  checks.cockroachMcp = mcpConfigured();

  return NextResponse.json(
    { status: dbOk ? "ok" : "degraded", checks, timestamp: new Date().toISOString() },
    { status: dbOk ? 200 : 503 },
  );
}
