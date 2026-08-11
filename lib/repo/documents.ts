import { sql } from "@/db/client";
import type { DocumentRecord, DocumentSourceType, DocumentStatus } from "@/lib/types";

function mapDocument(row: Record<string, unknown>): DocumentRecord {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    projectId: (row.project_id as string) ?? null,
    uploadedBy: (row.uploaded_by as string) ?? null,
    filename: row.filename as string,
    mimeType: (row.mime_type as string) ?? null,
    s3Key: row.s3_key as string,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    extractedText: (row.extracted_text as string) ?? null,
    status: row.status as DocumentStatus,
    sourceType: (row.source_type as DocumentSourceType) ?? "OTHER",
    authorityScore: Number(row.authority_score ?? 0.6),
    contentHash: (row.content_hash as string) ?? null,
    pageCount: row.page_count === null ? null : Number(row.page_count),
    processingError: (row.processing_error as string) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    processedAt: row.processed_at ? (row.processed_at as Date).toISOString() : null,
  };
}

export async function createDocument(input: {
  tenantId: string;
  projectId?: string | null;
  uploadedBy?: string | null;
  filename: string;
  mimeType?: string | null;
  s3Key: string;
  sizeBytes?: number | null;
  sourceType?: DocumentSourceType;
  authorityScore?: number;
}): Promise<DocumentRecord> {
  const [row] = await sql`
    INSERT INTO documents (
      tenant_id, project_id, uploaded_by, filename, mime_type, s3_key,
      size_bytes, source_type, authority_score
    ) VALUES (
      ${input.tenantId}, ${input.projectId ?? null}, ${input.uploadedBy ?? null},
      ${input.filename}, ${input.mimeType ?? null}, ${input.s3Key},
      ${input.sizeBytes ?? null}, ${input.sourceType ?? "OTHER"},
      ${input.authorityScore ?? 0.6}
    )
    RETURNING *
  `;
  return mapDocument(row!);
}

export async function updateDocumentStatus(
  documentId: string,
  status: DocumentStatus,
  fields: {
    extractedText?: string;
    processingError?: string;
    contentHash?: string;
    pageCount?: number;
  } = {},
): Promise<void> {
  await sql`
    UPDATE documents
    SET status = ${status},
        extracted_text = COALESCE(${fields.extractedText ?? null}, extracted_text),
        content_hash = COALESCE(${fields.contentHash ?? null}, content_hash),
        page_count = COALESCE(${fields.pageCount ?? null}, page_count),
        processing_error = ${fields.processingError ?? null},
        processed_at = CASE WHEN ${status} IN ('PROCESSED', 'FAILED') THEN now() ELSE processed_at END
    WHERE id = ${documentId}
  `;
}

export async function getDocumentById(
  tenantId: string,
  documentId: string,
): Promise<DocumentRecord | null> {
  const [row] = await sql`
    SELECT * FROM documents WHERE id = ${documentId} AND tenant_id = ${tenantId}
  `;
  return row ? mapDocument(row) : null;
}

export async function listDocuments(
  tenantId: string,
  opts: { projectId?: string } = {},
): Promise<DocumentRecord[]> {
  const rows = await sql`
    SELECT * FROM documents
    WHERE tenant_id = ${tenantId}
      ${opts.projectId ? sql`AND project_id = ${opts.projectId}` : sql``}
    ORDER BY created_at DESC
  `;
  return rows.map(mapDocument);
}

/**
 * Finds an already-ingested document with identical content. Re-uploading
 * the same file should not produce a second round of identical conflicts
 * (§72), so ingestion checks this before running the pipeline again.
 */
export async function findProcessedDocumentByHash(
  tenantId: string,
  contentHash: string,
  excludeDocumentId?: string,
): Promise<DocumentRecord | null> {
  const [row] = await sql`
    SELECT * FROM documents
    WHERE tenant_id = ${tenantId}
      AND content_hash = ${contentHash}
      AND status = 'PROCESSED'
      ${excludeDocumentId ? sql`AND id != ${excludeDocumentId}` : sql``}
    ORDER BY created_at ASC
    LIMIT 1
  `;
  return row ? mapDocument(row) : null;
}
