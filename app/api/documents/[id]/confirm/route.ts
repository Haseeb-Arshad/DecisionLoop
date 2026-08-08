import { NextRequest, NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { ingestDocument } from "@/lib/engine/documentIngestion";
import { recordAuditEvent } from "@/lib/repo/auditEvents";
import { getDocumentById } from "@/lib/repo/documents";

/**
 * Step 2 of document upload: called once the browser's PUT to S3 succeeds.
 * Runs the full ingestion pipeline synchronously — extract text, embed,
 * index, run assumption-conflict detection — and returns a summary
 * including any decisions that were just marked AT_RISK. See
 * lib/engine/documentIngestion.ts.
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

    const result = await ingestDocument(document);

    await recordAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.user.id,
      action: "document.ingested",
      entityType: "document",
      entityId: document.id,
      metadata: {
        chunksIndexed: result.chunksIndexed,
        conflictSummary: result.conflictSummary,
      },
    });

    return NextResponse.json({
      document: result.document,
      conflictSummary: result.conflictSummary,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
