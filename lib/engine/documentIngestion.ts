import { embedTexts } from "@/lib/ai/embeddings";
import { runConflictDetectionForDocument } from "@/lib/engine/conflictDetection";
import { getObjectBuffer } from "@/lib/aws/s3";
import { childLogger } from "@/lib/logger";
import { updateDocumentStatus } from "@/lib/repo/documents";
import { insertMemoryChunk } from "@/lib/repo/memoryChunks";
import { extractTextFromBuffer } from "@/lib/util/textExtraction";
import type { ConflictDetectionSummary } from "@/lib/engine/conflictDetection";
import type { DocumentRecord } from "@/lib/types";

const log = childLogger({ module: "documentIngestion" });

// Simple fixed-window chunking by paragraph, capped so a very long document
// doesn't blow up the embedding call count. Good enough for the pricing
// sheets / short reports this demo targets; a production build would use a
// token-aware splitter.
const MAX_CHUNKS_PER_DOCUMENT = 12;
const MIN_CHUNK_LENGTH = 40;

function chunkText(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length >= MIN_CHUNK_LENGTH);

  if (paragraphs.length > 0) {
    return paragraphs.slice(0, MAX_CHUNKS_PER_DOCUMENT);
  }

  // Fallback for documents with no blank-line paragraph breaks: fixed-size
  // character windows.
  const windows: string[] = [];
  const windowSize = 1200;
  for (let i = 0; i < text.length && windows.length < MAX_CHUNKS_PER_DOCUMENT; i += windowSize) {
    const slice = text.slice(i, i + windowSize).trim();
    if (slice.length >= MIN_CHUNK_LENGTH) windows.push(slice);
  }
  return windows;
}

export interface IngestionResult {
  document: DocumentRecord;
  chunksIndexed: number;
  conflictSummary: ConflictDetectionSummary;
}

/**
 * Full pipeline for a newly-uploaded document: fetch from S3 → extract text
 * → chunk + embed into memory_chunks → run assumption-conflict detection.
 * Runs synchronously in the request that confirms the upload — fine at
 * hackathon-demo document sizes/volume; a production build would move this
 * to a queue.
 */
export async function ingestDocument(document: DocumentRecord): Promise<IngestionResult> {
  await updateDocumentStatus(document.id, "PROCESSING");

  try {
    const buffer = await getObjectBuffer(document.s3Key);
    const text = await extractTextFromBuffer(buffer, document.mimeType, document.filename);

    if (!text || text.trim().length < MIN_CHUNK_LENGTH) {
      await updateDocumentStatus(document.id, "FAILED", {
        processingError: "No extractable text found in this document.",
      });
      throw new Error("No extractable text found in document " + document.id);
    }

    const chunks = chunkText(text);
    const { embeddings, model } = await embedTexts(chunks);

    await Promise.all(
      embeddings.map((embedding, i) =>
        insertMemoryChunk({
          tenantId: document.tenantId,
          sourceType: "document",
          sourceId: document.id,
          decisionId: null,
          content: chunks[i]!,
          embedding,
          embeddingModel: model,
        }),
      ),
    );

    await updateDocumentStatus(document.id, "PROCESSED", { extractedText: text });

    const processed: DocumentRecord = { ...document, status: "PROCESSED", extractedText: text };

    const conflictSummary = await runConflictDetectionForDocument(processed);

    log.info(
      { chunks: chunks.length, ...conflictSummary },
      "document ingested and checked for assumption conflicts",
    );

    return { document: processed, chunksIndexed: chunks.length, conflictSummary };
  } catch (err) {
    log.error({ err, documentId: document.id }, "document ingestion failed");
    await updateDocumentStatus(document.id, "FAILED", {
      processingError: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
