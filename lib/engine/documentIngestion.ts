import crypto from "node:crypto";
import { embedTexts } from "@/lib/ai/embeddings";
import { withAgentRun } from "@/lib/engine/agentRun";
import { runConflictDetectionForDocument } from "@/lib/engine/conflictDetection";
import { getObjectBuffer } from "@/lib/aws/s3";
import { childLogger } from "@/lib/logger";
import {
  findProcessedDocumentByHash,
  updateDocumentStatus,
} from "@/lib/repo/documents";
import { insertMemoryChunk } from "@/lib/repo/memoryChunks";
import { recordMemoryEvent } from "@/lib/repo/memoryEvents";
import { extractTextFromBuffer } from "@/lib/util/textExtraction";
import type { ConflictDetectionSummary } from "@/lib/engine/conflictDetection";
import type { DocumentRecord } from "@/lib/types";

const log = childLogger({ module: "documentIngestion" });

// Paragraph-first chunking with a bounded fixed-size fallback. Good enough
// for the pricing sheets and short reports this product targets; §47 warns
// against sending whole documents to the model, and these bounds are what
// enforce that.
const MAX_CHUNKS_PER_DOCUMENT = 24;
const MIN_CHUNK_LENGTH = 40;
const MAX_CHUNK_LENGTH = 1200;

export interface TextChunk {
  content: string;
  index: number;
  /** 1-based page, when the extractor could attribute one. */
  pageNumber: number | null;
}

function splitIntoWindows(text: string): string[] {
  const windows: string[] = [];
  for (let i = 0; i < text.length; i += MAX_CHUNK_LENGTH) {
    const slice = text.slice(i, i + MAX_CHUNK_LENGTH).trim();
    if (slice.length >= MIN_CHUNK_LENGTH) windows.push(slice);
  }
  return windows;
}

export function chunkText(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length >= MIN_CHUNK_LENGTH);

  // Paragraph splitting alone doesn't bound chunk size — a document with no
  // blank-line breaks at all (or one enormous paragraph) would otherwise
  // become a single oversized chunk. Further window any paragraph that's
  // still too long, so every chunk this function returns is bounded.
  const base =
    paragraphs.length > 0
      ? paragraphs
      : [text.trim()].filter((t) => t.length >= MIN_CHUNK_LENGTH);

  const bounded = base
    .flatMap((p) => (p.length > MAX_CHUNK_LENGTH ? splitIntoWindows(p) : [p]))
    .filter((p) => p.length >= MIN_CHUNK_LENGTH);

  return bounded.slice(0, MAX_CHUNKS_PER_DOCUMENT);
}

/**
 * Chunks text while tracking which page each chunk came from, so evidence
 * can cite "SignalForge Proposal — page 3" rather than just naming the file
 * (§11, §22). Page boundaries come from the form-feed characters pdf-parse
 * emits; plain text has no pages and yields nulls.
 */
export function chunkTextWithPages(text: string): TextChunk[] {
  const pages = text.split("\f");
  const hasPages = pages.length > 1;
  const chunks: TextChunk[] = [];

  pages.forEach((pageText, pageIdx) => {
    for (const content of chunkText(pageText)) {
      if (chunks.length >= MAX_CHUNKS_PER_DOCUMENT) return;
      chunks.push({
        content,
        index: chunks.length,
        pageNumber: hasPages ? pageIdx + 1 : null,
      });
    }
  });

  return chunks;
}

export function hashContent(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export interface IngestionResult {
  document: DocumentRecord;
  chunksIndexed: number;
  duplicateOf: string | null;
  conflictSummary: ConflictDetectionSummary | null;
  agentRunId: string;
}

/**
 * Full pipeline for a newly-uploaded document (§20): fetch from S3 →
 * extract text → hash → chunk + embed into memory_chunks → run
 * assumption-conflict detection. Wrapped in an agent run so timings,
 * retrieval counts and conflict counts are recorded rather than only
 * logged.
 *
 * Runs synchronously in the request that confirms the upload — acceptable
 * at demo document sizes and volume; a production build would move this to
 * a queue (see docs/architecture.md §"Known limitations").
 */
export async function ingestDocument(
  document: DocumentRecord,
  opts: { sessionId: string; userId?: string | null },
): Promise<IngestionResult> {
  const { result } = await withAgentRun<IngestionResult>(
    {
      tenantId: document.tenantId,
      projectId: document.projectId,
      sessionId: opts.sessionId,
      intent: "INGEST_EVIDENCE",
      request: `Ingest document: ${document.filename}`,
      createdBy: opts.userId ?? null,
    },
    async (ctx) => {
      await updateDocumentStatus(document.id, "PROCESSING");

      try {
        const buffer = await getObjectBuffer(document.s3Key);
        const text = await extractTextFromBuffer(
          buffer,
          document.mimeType,
          document.filename,
        );

        if (!text || text.trim().length < MIN_CHUNK_LENGTH) {
          await updateDocumentStatus(document.id, "FAILED", {
            processingError: "No extractable text found in this document.",
          });
          throw new Error(`No extractable text found in document ${document.id}`);
        }

        const contentHash = hashContent(text);

        // Identical content already ingested → record the document but skip
        // re-embedding and re-running conflict detection, so a duplicate
        // upload can't manufacture a second round of identical conflicts.
        const duplicate = await findProcessedDocumentByHash(
          document.tenantId,
          contentHash,
          document.id,
        );
        if (duplicate) {
          await updateDocumentStatus(document.id, "PROCESSED", {
            extractedText: text,
            contentHash,
          });
          log.info(
            { documentId: document.id, duplicateOf: duplicate.id },
            "duplicate document content; skipped re-analysis",
          );
          return {
            result: {
              document: { ...document, status: "PROCESSED" as const, extractedText: text },
              chunksIndexed: 0,
              duplicateOf: duplicate.id,
              conflictSummary: null,
              agentRunId: ctx.run.id,
            },
            outputSummary: `Duplicate of ${duplicate.filename}; no re-analysis performed.`,
          };
        }

        const chunks = chunkTextWithPages(text);
        const { embeddings, model } = await embedTexts(chunks.map((c) => c.content));

        await Promise.all(
          embeddings.map((embedding, i) =>
            insertMemoryChunk({
              tenantId: document.tenantId,
              projectId: document.projectId,
              sourceType: "document",
              sourceId: document.id,
              decisionId: null,
              content: chunks[i]!.content,
              embedding,
              embeddingModel: model,
              pageNumber: chunks[i]!.pageNumber,
              chunkIndex: chunks[i]!.index,
              contentHash: hashContent(chunks[i]!.content),
              // Evidence inherits its document's authority; importance for a
              // raw excerpt stays neutral — it is the assumption it bears on
              // that carries importance, not the paragraph itself.
              importance: 0.5,
              authorityScore: document.authorityScore,
              metadata: { filename: document.filename, sourceType: document.sourceType },
            }),
          ),
        );

        ctx.recordWrites(chunks.length);

        await updateDocumentStatus(document.id, "PROCESSED", {
          extractedText: text,
          contentHash,
          pageCount: chunks.some((c) => c.pageNumber) ? text.split("\f").length : undefined,
        });

        await recordMemoryEvent({
          tenantId: document.tenantId,
          projectId: document.projectId,
          entityType: "document",
          entityId: document.id,
          eventType: "EVIDENCE_ADDED",
          agentRunId: ctx.run.id,
          actorType: opts.userId ? "USER" : "SYSTEM",
          actorUserId: opts.userId ?? null,
          summary: `${document.filename} ingested as ${chunks.length} memory chunk${chunks.length === 1 ? "" : "s"}.`,
          metadata: { sourceType: document.sourceType, authorityScore: document.authorityScore },
        });

        const processed: DocumentRecord = {
          ...document,
          status: "PROCESSED",
          extractedText: text,
          contentHash,
        };

        const conflictSummary = await runConflictDetectionForDocument(processed, ctx);

        log.info(
          { chunks: chunks.length, ...conflictSummary },
          "document ingested and checked for assumption conflicts",
        );

        return {
          result: {
            document: processed,
            chunksIndexed: chunks.length,
            duplicateOf: null,
            conflictSummary,
            agentRunId: ctx.run.id,
          },
          outputSummary:
            `Extracted ${conflictSummary.factsExtracted} fact(s); ` +
            `${conflictSummary.conflictsFound} conflict(s) found across ` +
            `${conflictSummary.candidatesConsidered} candidate assumption(s).`,
        };
      } catch (err) {
        log.error({ err, documentId: document.id }, "document ingestion failed");
        await updateDocumentStatus(document.id, "FAILED", {
          processingError: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
  );

  return result;
}
