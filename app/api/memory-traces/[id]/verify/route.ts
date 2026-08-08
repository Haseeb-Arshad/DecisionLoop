import { NextRequest, NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { verifyRowsViaMcp } from "@/lib/mcp/cockroachClient";
import { attachMcpVerification, getMemoryTraceById } from "@/lib/repo/memoryTraces";
import { recordAuditEvent } from "@/lib/repo/auditEvents";

/**
 * The Memory Inspector's "independently verify" button: re-runs the used
 * chunk IDs through CockroachDB's own Managed MCP Server (a second,
 * Anthropic-facing channel, not the app's own DB pool) and attaches the
 * result to the trace. See lib/mcp/cockroachClient.ts.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const trace = await getMemoryTraceById(auth.tenantId, id);
    if (!trace) return jsonError("Memory trace not found.", 404);

    const chunkIds = trace.usedChunkIds.length > 0
      ? trace.usedChunkIds
      : trace.candidates.slice(0, 5).map((c) => c.chunkId);

    const verification = await verifyRowsViaMcp(chunkIds);
    await attachMcpVerification(trace.id, verification);

    await recordAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.user.id,
      action: "memory_trace.mcp_verified",
      entityType: "memory_trace",
      entityId: trace.id,
      metadata: { verified: verification.verified },
    });

    return NextResponse.json({ trace: { ...trace, mcpVerification: verification } });
  } catch (err) {
    return handleApiError(err);
  }
}
