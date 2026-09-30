import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/currentUser";
import { getDecisionLoop } from "@/lib/decisionloopInstance";
import { sql } from "@/db/client";
import { handleApiError } from "@/lib/api/handler";

export async function GET() {
  try {
    const { tenantId } = await requireAuth();
    const loop = getDecisionLoop();
    const decisions = await loop.store.listDecisions(tenantId, { limit: 500 });
    const [heartbeat] = await sql<
      { seen_at: Date | string | null }[]
    >`SELECT max(seen_at) AS seen_at FROM worker_heartbeats`;
    const [queue] = await sql<
      { pending: string; oldest: Date | string | null }[]
    >`SELECT count(*) AS pending, min(created_at) AS oldest FROM jobs WHERE tenant_id = ${tenantId} AND status IN ('QUEUED', 'RUNNING', 'FAILED')`;
    return NextResponse.json({
      decisions,
      capabilities: {
        reasoning: loop.deps.reasoning.name,
        embeddings: loop.deps.embeddings.modelName,
        documentUpload: Boolean(
          process.env.S3_BUCKET_NAME?.trim() && process.env.AWS_REGION?.trim() &&
          loop.deps.reasoning.name !== "none",
        ),
        workerSeenAt: heartbeat?.seen_at ?? null,
        workerHealthy: Boolean(
          heartbeat?.seen_at &&
          Date.now() - new Date(heartbeat.seen_at).getTime() < 60000,
        ),
        pendingJobs: Number(queue?.pending ?? 0),
        oldestJobAt: queue?.oldest ?? null,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
