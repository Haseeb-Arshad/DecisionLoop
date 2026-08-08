import { embedText } from "@/lib/ai/embeddings";
import { judgeAssumptionConflict } from "@/lib/ai/conflict";
import { extractFactsFromDocument } from "@/lib/ai/extraction";
import { recordAuditEvent } from "@/lib/repo/auditEvents";
import { createConflictEvent } from "@/lib/repo/conflictEvents";
import {
  getAssumptionById,
  getDecisionById,
  invalidateAssumption,
  updateDecisionStatus,
} from "@/lib/repo/decisions";
import { searchMemoryChunks } from "@/lib/repo/memoryChunks";
import { recordMemoryTrace } from "@/lib/repo/memoryTraces";
import type { DocumentRecord } from "@/lib/types";

const CANDIDATE_LIMIT = 5;
// Below this cosine similarity, a candidate assumption isn't a close enough
// match to spend an LLM call judging it — keeps the pipeline both cheap and
// auditable (the Memory Inspector shows what was filtered out and why).
const SIMILARITY_THRESHOLD = 0.25;

export interface ConflictDetectionSummary {
  documentId: string;
  factsExtracted: number;
  candidatesConsidered: number;
  conflictsFound: number;
  decisionsMarkedAtRisk: string[];
}

/**
 * The core "automatic assumption invalidation" loop. Given a document that
 * was just ingested, this function is deliberately NOT told which decision
 * (if any) the document relates to — every fact it extracts is checked, via
 * vector search over the tenant's ENTIRE assumption memory, against
 * whichever stored assumptions look related. That's what makes recall
 * "independent": nothing upstream of this function passes it a decisionId.
 *
 * See docs/architecture.md §6 for the step-by-step description and §"Defining
 * demo" for why this is the scenario the whole build is judged against.
 */
export async function runConflictDetectionForDocument(
  document: DocumentRecord,
): Promise<ConflictDetectionSummary> {
  const text = document.extractedText;
  if (!text) {
    throw new Error(`Document ${document.id} has no extracted text to analyze.`);
  }

  const facts = await extractFactsFromDocument(text);

  let candidatesConsidered = 0;
  let conflictsFound = 0;
  const decisionsMarkedAtRisk = new Set<string>();

  for (const fact of facts) {
    const { embedding } = await embedText(`${fact.subject}: ${fact.statement}`);
    const { candidates, renderedSql } = await searchMemoryChunks(
      document.tenantId,
      embedding,
      { limit: CANDIDATE_LIMIT, sourceType: "assumption" },
    );

    const strongCandidates = candidates.filter((c) => c.similarity >= SIMILARITY_THRESHOLD);
    candidatesConsidered += strongCandidates.length;

    const usedChunkIds: string[] = [];
    const reasoningLog: string[] = [];
    let conflictDecisionId: string | null = null;

    for (const candidate of strongCandidates) {
      const assumption = await getAssumptionById(candidate.sourceId);
      if (!assumption || assumption.status !== "VALID") {
        reasoningLog.push(
          `[similarity ${candidate.similarity.toFixed(3)}] assumption ${candidate.sourceId} skipped ` +
            `(${assumption ? "already " + assumption.status.toLowerCase() : "not found"}).`,
        );
        continue;
      }

      const decision = await getDecisionById(document.tenantId, assumption.decisionId);
      if (!decision) continue;

      const otherOptionNames = decision.options
        .filter((o) => !o.isChosen)
        .map((o) => o.name);

      const judgment = await judgeAssumptionConflict({
        fact,
        assumption,
        decisionTitle: decision.title,
        otherOptionNames,
      });

      reasoningLog.push(
        `[similarity ${candidate.similarity.toFixed(3)}] "${assumption.statement}" vs fact "${fact.statement}" ` +
          `→ invalidated=${judgment.invalidated}: ${judgment.explanation}`,
      );

      if (!judgment.invalidated) continue;

      usedChunkIds.push(candidate.chunkId);
      conflictsFound += 1;
      conflictDecisionId = decision.id;

      await invalidateAssumption(assumption.id);
      await updateDecisionStatus(
        document.tenantId,
        decision.id,
        "AT_RISK",
        judgment.explanation,
      );
      decisionsMarkedAtRisk.add(decision.id);

      const suggestedOption = decision.options.find(
        (o) => o.name.toLowerCase() === judgment.suggestedOptionName.trim().toLowerCase(),
      );

      const conflictEvent = await createConflictEvent({
        tenantId: document.tenantId,
        decisionId: decision.id,
        assumptionId: assumption.id,
        documentId: document.id,
        factStatement: fact.statement,
        explanation: judgment.explanation,
        suggestedOptionId: suggestedOption?.id ?? null,
      });

      await recordAuditEvent({
        tenantId: document.tenantId,
        actorLabel: "system",
        action: "decision.marked_at_risk",
        entityType: "decision",
        entityId: decision.id,
        metadata: {
          conflictEventId: conflictEvent.id,
          documentId: document.id,
          assumptionId: assumption.id,
          factStatement: fact.statement,
        },
      });
    }

    // One memory trace per extracted fact — even when nothing conflicted —
    // so the Memory Inspector can show "checked, no conflict" as evidence,
    // not just the cases where something changed.
    const trace = await recordMemoryTrace({
      tenantId: document.tenantId,
      actionType: "conflict_check",
      relatedDocumentId: document.id,
      relatedDecisionId: conflictDecisionId,
      queryText: fact.statement,
      renderedSql,
      candidates: strongCandidates,
      usedChunkIds,
      llmReasoning:
        reasoningLog.join("\n") ||
        "No stored assumption was a close enough vector match to check against this fact.",
    });

    if (conflictDecisionId) {
      // Link the conflict_events row we just wrote back to its trace, so
      // the "AT RISK" banner can deep-link straight into the Inspector.
      await recordAuditEvent({
        tenantId: document.tenantId,
        actorLabel: "system",
        action: "memory_trace.linked",
        entityType: "memory_trace",
        entityId: trace.id,
        metadata: { documentId: document.id },
      });
    }
  }

  return {
    documentId: document.id,
    factsExtracted: facts.length,
    candidatesConsidered,
    conflictsFound,
    decisionsMarkedAtRisk: Array.from(decisionsMarkedAtRisk),
  };
}
