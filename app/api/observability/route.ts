import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { getObservabilityMetrics, listAgentRuns } from "@/lib/repo/agentRuns";
import { listRecentMemoryEvents } from "@/lib/repo/memoryEvents";
import { listRecentConflictEvents } from "@/lib/repo/conflictEvents";

/**
 * §32 metrics, all computed from real rows — a metric with no data returns
 * 0 or null rather than a plausible-looking placeholder.
 */
export async function GET() {
  try {
    const auth = await requireAuth();

    const [metrics, runs, memoryEvents, conflicts] = await Promise.all([
      getObservabilityMetrics(auth.tenantId),
      listAgentRuns(auth.tenantId, 25),
      listRecentMemoryEvents(auth.tenantId, 25),
      listRecentConflictEvents(auth.tenantId, { limit: 10 }),
    ]);

    return NextResponse.json({ metrics, runs, memoryEvents, conflicts });
  } catch (err) {
    return handleApiError(err);
  }
}
