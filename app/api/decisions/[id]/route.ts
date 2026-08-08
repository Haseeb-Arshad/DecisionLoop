import { NextRequest, NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { getDecisionById } from "@/lib/repo/decisions";
import { listConflictEventsForDecision } from "@/lib/repo/conflictEvents";
import { listMemoryTraces } from "@/lib/repo/memoryTraces";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const decision = await getDecisionById(auth.tenantId, id);
    if (!decision) return jsonError("Decision not found.", 404);

    const [conflicts, traces] = await Promise.all([
      listConflictEventsForDecision(id),
      listMemoryTraces(auth.tenantId, { decisionId: id, limit: 25 }),
    ]);

    return NextResponse.json({ decision, conflicts, traces });
  } catch (err) {
    return handleApiError(err);
  }
}
