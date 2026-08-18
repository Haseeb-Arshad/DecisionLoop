import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api/handler";
import { MAX_UPLOAD_BYTES } from "@/lib/api/uploadTypes";
import { requireAuth } from "@/lib/auth/currentUser";
import { buildDocumentKey, getPresignedUploadUrl } from "@/lib/aws/s3";
import { authorityForSourceType } from "@/lib/domain/decisionStatus";
import { recordAuditEvent } from "@/lib/repo/auditEvents";
import { createDocument } from "@/lib/repo/documents";
import { getOrCreateDefaultProject, getProjectById } from "@/lib/repo/projects";

/**
 * Allowed upload types (§31, §34): PDF, plain text, Markdown. Anything else
 * is rejected at the API boundary rather than discovered mid-extraction —
 * uploaded files are untrusted input, so the accepted set is an allowlist,
 * not a blocklist.
 */
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
] as const;

const RequestSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  projectId: z.string().uuid().optional(),
  sourceType: z
    .enum(["CONTRACT", "VENDOR_OFFICIAL", "INTERNAL_ANALYSIS", "NEWS", "UNVERIFIED", "OTHER"])
    .default("OTHER"),
});

/**
 * Step 1 of document upload: creates the `documents` row (status UPLOADED)
 * and returns a presigned S3 PUT URL. The browser uploads directly to S3.
 * The caller then POSTs /api/documents/:id/confirm once the PUT succeeds.
 *
 * The declared source type sets the document's authority score, which is
 * what governs whether its contents can invalidate an assumption outright
 * or only challenge it (§20).
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = RequestSchema.parse(await req.json());

    const project = body.projectId
      ? await getProjectById(auth.tenantId, body.projectId)
      : await getOrCreateDefaultProject(auth.tenantId, auth.user.id);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    const projectId = project.id;

    const s3Key = buildDocumentKey(auth.tenantId, body.filename);
    const uploadUrl = await getPresignedUploadUrl(s3Key, body.mimeType, body.sizeBytes);

    const document = await createDocument({
      tenantId: auth.tenantId,
      projectId,
      uploadedBy: auth.user.id,
      filename: body.filename,
      mimeType: body.mimeType,
      s3Key,
      sizeBytes: body.sizeBytes,
      sourceType: body.sourceType,
      authorityScore: authorityForSourceType(body.sourceType),
    });

    await recordAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.user.id,
      action: "document.upload_initiated",
      entityType: "document",
      entityId: document.id,
      metadata: {
        filename: body.filename,
        sourceType: body.sourceType,
        authorityScore: document.authorityScore,
      },
    });

    return NextResponse.json({ document, uploadUrl });
  } catch (err) {
    return handleApiError(err);
  }
}
