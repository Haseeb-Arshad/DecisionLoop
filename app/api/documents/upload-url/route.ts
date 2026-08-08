import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { buildDocumentKey, getPresignedUploadUrl } from "@/lib/aws/s3";
import { recordAuditEvent } from "@/lib/repo/auditEvents";
import { createDocument } from "@/lib/repo/documents";

const RequestSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive().max(50 * 1024 * 1024), // 50MB
});

/**
 * Step 1 of document upload: creates the `documents` row (status UPLOADED)
 * and returns a presigned S3 PUT URL. The browser uploads directly to S3 —
 * see docs/architecture.md §3 for why. The caller then POSTs
 * /api/documents/:id/confirm once the PUT succeeds.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = RequestSchema.parse(await req.json());

    const s3Key = buildDocumentKey(auth.tenantId, body.filename);
    const uploadUrl = await getPresignedUploadUrl(s3Key, body.mimeType);

    const document = await createDocument({
      tenantId: auth.tenantId,
      uploadedBy: auth.user.id,
      filename: body.filename,
      mimeType: body.mimeType,
      s3Key,
      sizeBytes: body.sizeBytes,
    });

    await recordAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.user.id,
      action: "document.upload_initiated",
      entityType: "document",
      entityId: document.id,
      metadata: { filename: body.filename },
    });

    return NextResponse.json({ document, uploadUrl });
  } catch (err) {
    return handleApiError(err);
  }
}
