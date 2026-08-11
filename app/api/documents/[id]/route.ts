import { NextRequest, NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { getPresignedDownloadUrl } from "@/lib/aws/s3";
import { getDocumentById } from "@/lib/repo/documents";
import { listMemoryChunksForSource } from "@/lib/repo/memoryChunks";

/**
 * Evidence Viewer data (§36): the document's extracted text, the chunks it
 * was split into (with page attribution), and a short-lived presigned URL
 * for the original file. The original is never served from a public bucket
 * — the URL is generated per request and expires.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const document = await getDocumentById(auth.tenantId, id);
    if (!document) return jsonError("Document not found.", 404);

    const chunks = await listMemoryChunksForSource(auth.tenantId, "document", id);

    let downloadUrl: string | null = null;
    try {
      downloadUrl = await getPresignedDownloadUrl(document.s3Key, 300);
    } catch {
      // S3 unconfigured in local dev — the extracted text below is still
      // fully usable, so this degrades rather than failing the whole view.
      downloadUrl = null;
    }

    return NextResponse.json({ document, chunks, downloadUrl });
  } catch (err) {
    return handleApiError(err);
  }
}
