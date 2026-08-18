import { NextRequest, NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { indexDecisionMemory } from "@/lib/engine/decisionMemory";
import { recordAuditEvent } from "@/lib/repo/auditEvents";
import {
  getDecisionById,
  getDecisionCommitKey,
  setDecisionMemoryIndexStatus,
} from "@/lib/repo/decisions";

/** Retry only the durable memory-index stage of a previously saved decision. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    const decision = await getDecisionById(auth.tenantId, id);
    if (!decision) return jsonError("Decision not found.", 404);
    if (decision.memoryIndexStatus === "INDEXED") {
      return NextResponse.json({ decision, retried: false });
    }

    await setDecisionMemoryIndexStatus(auth.tenantId, id, "PENDING", null);
    try {
      const commitKey = await getDecisionCommitKey(auth.tenantId, id);
      const { chunksWritten } = await indexDecisionMemory(decision, {
        actorUserId: auth.user.id,
        dedupeKey: commitKey ? `decision:${commitKey}` : `decision:${id}`,
      });
      const indexed = await setDecisionMemoryIndexStatus(
        auth.tenantId,
        id,
        "INDEXED",
        null,
      );
      await recordAuditEvent({
        tenantId: auth.tenantId,
        actorUserId: auth.user.id,
        action: "decision.memory_reindexed",
        entityType: "decision",
        entityId: id,
        dedupeKey: `decision:${id}:memory-reindexed`,
        metadata: { chunksWritten },
      });
      return NextResponse.json({ decision: indexed, retried: true });
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 1000) : "Memory indexing failed.";
      const failed = await setDecisionMemoryIndexStatus(auth.tenantId, id, "FAILED", message);
      return NextResponse.json(
        { decision: failed, error: "Memory indexing failed; retry when the provider is available.", retryable: true },
        { status: 202 },
      );
    }
  } catch (err) {
    return handleApiError(err);
  }
}
