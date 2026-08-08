import { sql } from "@/db/client";
import type { DocumentRecord, DocumentStatus } from "@/lib/types";

function mapDocument(row: Record<string, unknown>): DocumentRecord {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    uploadedBy: (row.uploaded_by as string) ?? null,
    filename: row.filename as string,
    mimeType: (row.mime_type as string) ?? null,
    s3Key: row.s3_key as string,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    extractedText: (row.extracted_text as string) ?? null,
    status: row.status as DocumentStatus,
    processingError: (row.processing_error as string) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    processedAt: row.processed_at ? (row.processed_at as Date).toISOString() : null,
  };
}

export async function createDocument(input: {
  tenantId: string;
  uploadedBy?: string | null;
  filename: string;
  mimeType?: string | null;
  s3Key: string;
  sizeBytes?: number | null;
}): Promise<DocumentRecord> {
  const [row] = await sql`
    INSERT INTO documents (tenant_id, uploaded_by, filename, mime_type, s3_key, size_bytes)
    VALUES (
      ${input.tenantId}, ${input.uploadedBy ?? null}, ${input.filename},
      ${input.mimeType ?? null}, ${input.s3Key}, ${input.sizeBytes ?? null}
    )
    RETURNING *
  `;
  return mapDocument(row);
}

export async function updateDocumentStatus(
  documentId: string,
  status: DocumentStatus,
  fields: { extractedText?: string; processingError?: string } = {},
): Promise<void> {
  await sql`
    UPDATE documents
    SET status = ${status},
        extracted_text = COALESCE(${fields.extractedText ?? null}, extracted_text),
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

export async function listDocuments(tenantId: string): Promise<DocumentRecord[]> {
  const rows = await sql`
    SELECT * FROM documents WHERE tenant_id = ${tenantId} ORDER BY created_at DESC
  `;
  return rows.map(mapDocument);
}
