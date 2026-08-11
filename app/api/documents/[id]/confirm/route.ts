import { NextRequest, NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { sessionIdFor } from "@/lib/engine/agentRun";
import { ingestDocument } from "@/lib/engine/documentIngestion";
import { recordAuditEvent } from "@/lib/repo/auditEvents";
import { getDocumentById } from "@/lib/repo/documents";

/**
 * Step 2 of document upload: called once the browser's PUT to S3 succeeds.
 * Runs the full ingestion pipeline synchronously — extract text, embed,
 * index, run assumption-conflict detection — and returns a summary
 * including any decisions that were just marked AT_RISK.
 *
 * The agent run is keyed to the caller's auth session, which is what makes
 * the cross-session claim measurable: memory written under session 1 and
 * retrieved under session 2 is recorded as a cross-session recall.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const document = await getDocumentById(auth.tenantId, id);
    if (!document) return jsonError("Document not found.", 404);

    const result = await ingestDocument(document, {
      sessionId: sessionIdFor(auth.sessionId),
      userId: auth.user.id,
    });

    await recordAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.user.id,
      action: "document.ingested",
      entityType: "document",
      entityId: document.id,
      metadata: {
        chunksIndexed: result.chunksIndexed,
        duplicateOf: result.duplicateOf,
        agentRunId: result.agentRunId,
        conflictSummary: result.conflictSummary,
      },
    });

    return NextResponse.json({
      document: result.document,
      chunksIndexed: result.chunksIndexed,
      duplicateOf: result.duplicateOf,
      conflictSummary: result.conflictSummary,
      agentRunId: result.agentRunId,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
