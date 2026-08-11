import { NextRequest, NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { getDecisionById } from "@/lib/repo/decisions";
import { listConflictEventsForDecision } from "@/lib/repo/conflictEvents";
import { listEvidenceForDecision, listOutcomesForDecision } from "@/lib/repo/evidence";
import { listMemoryEventsForDecision } from "@/lib/repo/memoryEvents";
import { listMemoryTraces } from "@/lib/repo/memoryTraces";

/**
 * Everything the Decision Detail page needs, including the timeline (§24),
 * which is built from real memory_events rather than reconstructed from
 * timestamps on other tables.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const decision = await getDecisionById(auth.tenantId, id);
    if (!decision) return jsonError("Decision not found.", 404);

    const [conflicts, traces, evidence, timeline, outcomes] = await Promise.all([
      listConflictEventsForDecision(id),
      listMemoryTraces(auth.tenantId, { decisionId: id, limit: 25 }),
      listEvidenceForDecision(auth.tenantId, id),
      listMemoryEventsForDecision(auth.tenantId, id),
      listOutcomesForDecision(auth.tenantId, id),
    ]);

    return NextResponse.json({ decision, conflicts, traces, evidence, timeline, outcomes });
  } catch (err) {
    return handleApiError(err);
  }
}
