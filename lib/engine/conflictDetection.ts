import { judgeAssumptionConflict } from "@/lib/ai/conflict";
import { extractFactsFromDocument } from "@/lib/ai/extraction";
import { detectInjectionAttempt } from "@/lib/ai/promptSafety";
import { classifyConflictSeverity } from "@/lib/domain/decisionStatus";
import { retrieveMemory } from "@/lib/engine/retrieval";
import { childLogger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/repo/auditEvents";
import { recordRetrievalEvents } from "@/lib/repo/agentRuns";
import { createConflictEvent, findExistingConflict } from "@/lib/repo/conflictEvents";
import {
  getAssumptionById,
  getDecisionById,
  setAssumptionValidity,
  updateDecisionStatus,
} from "@/lib/repo/decisions";
import { createDecisionEvidence } from "@/lib/repo/evidence";
import { recordMemoryEvent } from "@/lib/repo/memoryEvents";
import { recordMemoryTrace } from "@/lib/repo/memoryTraces";
import { listMemoryChunksForSource } from "@/lib/repo/memoryChunks";
import type { AgentRunContext } from "@/lib/engine/agentRun";
import type { DocumentRecord, ScoredMemoryCandidate } from "@/lib/types";

const log = childLogger({ module: "conflictDetection" });

/** Candidates below this hybrid score aren't worth an LLM call to judge. */
const MIN_SCORE_TO_JUDGE = 0.35;
const CANDIDATES_PER_FACT = 6;
const MAX_JUDGED_PER_FACT = 3;

export interface ConflictDetectionSummary {
  documentId: string;
  factsExtracted: number;
  candidatesConsidered: number;
  conflictsFound: number;
  assumptionsInvalidated: number;
  assumptionsChallenged: number;
  decisionsMarkedAtRisk: string[];
  injectionSuspected: boolean;
  injectionPatterns: string[];
}

/**
 * The core "automatic assumption invalidation" loop (decision.md §20–§21).
 *
 * Given a document that was just ingested, this function is deliberately
 * NOT told which decision (if any) the document relates to — every fact it
 * extracts is checked, via hybrid retrieval over the tenant's ENTIRE
 * assumption memory, against whichever stored assumptions look related.
 * That's what makes recall *independent*: nothing upstream passes a
 * decisionId in.
 *
 * What a contradiction actually does to memory is decided by
 * lib/domain/decisionStatus.ts#classifyConflictSeverity, weighing the
 * model's confidence against the relative authority of the evidence and the
 * assumption — so an anonymous PDF can flag a decision for review but
 * cannot, on its own, invalidate a contract-backed assumption.
 */
export async function runConflictDetectionForDocument(
  document: DocumentRecord,
  ctx?: AgentRunContext,
): Promise<ConflictDetectionSummary> {
  const text = document.extractedText;
  if (!text) {
    throw new Error(`Document ${document.id} has no extracted text to analyze.`);
  }

  // Recorded for the audit trail and surfaced in the UI. Detection does not
  // gate processing — the defense is that document text is only ever fed to
  // extraction prompts with an explicit untrusted-content boundary, and that
  // no document-driven code path can mutate a decision. See
  // lib/ai/promptSafety.ts and docs/security.md.
  const injection = detectInjectionAttempt(text);
  if (injection.suspected) {
    log.warn(
      { documentId: document.id, patterns: injection.matchedPatterns },
      "possible prompt-injection content in uploaded document; processing as data only",
    );
    await recordAuditEvent({
      tenantId: document.tenantId,
      actorLabel: "system",
      action: "document.injection_suspected",
      entityType: "document",
      entityId: document.id,
      metadata: {
        patterns: injection.matchedPatterns,
        excerpts: injection.excerpts.slice(0, 3),
      },
    });
  }

  const facts = await extractFactsFromDocument(text);

  const documentChunks = await listMemoryChunksForSource(
    document.tenantId,
    "document",
    document.id,
  );

  let candidatesConsidered = 0;
  let conflictsFound = 0;
  let assumptionsInvalidated = 0;
  let assumptionsChallenged = 0;
  const decisionsMarkedAtRisk = new Set<string>();

  for (const fact of facts) {
    // Retrieve against assumptions only. The document's own chunks are
    // excluded so a document can't "corroborate itself" into the context.
    const retrieval = await retrieveMemory(
      document.tenantId,
      `${fact.subject}: ${fact.statement}`,
      {
        limit: CANDIDATES_PER_FACT,
        sourceType: "assumption",
        excludeSourceId: document.id,
        signals: { focusProjectId: document.projectId },
        selectTopK: MAX_JUDGED_PER_FACT,
        minFinalScore: MIN_SCORE_TO_JUDGE,
      },
    );

    ctx?.recordRetrieval(retrieval.latencyMs, retrieval.candidates.length);
    candidatesConsidered += retrieval.selected.length;

    const usedChunkIds: string[] = [];
    const reasoningLog: string[] = [];
    let conflictDecisionId: string | null = null;

    for (const candidate of retrieval.selected) {
      const outcome = await judgeCandidate({
        document,
        fact,
        candidate,
        agentRunId: ctx?.run.id ?? null,
        documentChunkId: documentChunks[0]?.id ?? null,
      });

      reasoningLog.push(outcome.log);
      if (!outcome.recorded) continue;

      usedChunkIds.push(candidate.chunkId);
      conflictsFound += 1;
      conflictDecisionId = outcome.decisionId;
      if (outcome.validity === "INVALIDATED") assumptionsInvalidated += 1;
      if (outcome.validity === "CHALLENGED") assumptionsChallenged += 1;
      if (outcome.decisionFlagged && outcome.decisionId) {
        decisionsMarkedAtRisk.add(outcome.decisionId);
      }
    }

    // One memory trace per extracted fact — even when nothing conflicted —
    // so the Memory Inspector can show "checked, no conflict" as evidence,
    // not just the cases where something changed.
    const trace = await recordMemoryTrace({
      tenantId: document.tenantId,
      agentRunId: ctx?.run.id ?? null,
      actionType: "conflict_check",
      relatedDocumentId: document.id,
      relatedDecisionId: conflictDecisionId,
      queryText: fact.statement,
      renderedSql: retrieval.renderedSql,
      candidates: retrieval.candidates,
      usedChunkIds,
      retrievalLatencyMs: retrieval.latencyMs,
      scoringWeights: retrieval.weights,
      llmReasoning:
        reasoningLog.join("\n") ||
        "No stored assumption scored above the retrieval threshold for this fact, so no conflict check was run.",
    });

    await recordRetrievalEvents({
      tenantId: document.tenantId,
      agentRunId: ctx?.run.id ?? null,
      memoryTraceId: trace.id,
      candidates: retrieval.candidates,
    });
  }

  ctx?.recordConflicts(conflictsFound);

  return {
    documentId: document.id,
    factsExtracted: facts.length,
    candidatesConsidered,
    conflictsFound,
    assumptionsInvalidated,
    assumptionsChallenged,
    decisionsMarkedAtRisk: Array.from(decisionsMarkedAtRisk),
    injectionSuspected: injection.suspected,
    injectionPatterns: injection.matchedPatterns,
  };
}

interface JudgeOutcome {
  recorded: boolean;
  log: string;
  decisionId: string | null;
  validity: "INVALIDATED" | "CHALLENGED" | null;
  decisionFlagged: boolean;
}

/**
 * Judges one (fact, retrieved assumption) pair and applies the result. Kept
 * separate so the retrieval loop above reads as the pipeline it is, and so
 * every early return has one obvious place to record why nothing happened.
 */
async function judgeCandidate(input: {
  document: DocumentRecord;
  fact: Awaited<ReturnType<typeof extractFactsFromDocument>>[number];
  candidate: ScoredMemoryCandidate;
  agentRunId: string | null;
  documentChunkId: string | null;
}): Promise<JudgeOutcome> {
  const { document, fact, candidate, agentRunId, documentChunkId } = input;
  const scorePrefix = `[score ${candidate.finalScore.toFixed(3)} · sim ${candidate.semanticScore.toFixed(3)}]`;

  const assumption = await getAssumptionById(candidate.sourceId);
  if (!assumption) {
    return {
      recorded: false,
      log: `${scorePrefix} assumption ${candidate.sourceId} no longer exists; skipped.`,
      decisionId: null,
      validity: null,
      decisionFlagged: false,
    };
  }

  if (assumption.validityStatus === "INVALIDATED" || assumption.validityStatus === "SUPERSEDED") {
    return {
      recorded: false,
      log: `${scorePrefix} "${assumption.statement}" is already ${assumption.validityStatus}; nothing further to do.`,
      decisionId: assumption.decisionId,
      validity: null,
      decisionFlagged: false,
    };
  }

  const decision = await getDecisionById(document.tenantId, assumption.decisionId);
  if (!decision) {
    return {
      recorded: false,
      log: `${scorePrefix} parent decision for assumption ${assumption.id} not found in this tenant; skipped.`,
      decisionId: null,
      validity: null,
      decisionFlagged: false,
    };
  }

  // Re-uploading the same pricing sheet must not raise the same conflict
  // twice (§72).
  const duplicate = await findExistingConflict(
    document.tenantId,
    assumption.id,
    document.id,
  );
  if (duplicate) {
    return {
      recorded: false,
      log: `${scorePrefix} this document already raised a conflict against "${assumption.statement}" (${duplicate.id}); not recording a duplicate.`,
      decisionId: decision.id,
      validity: null,
      decisionFlagged: false,
    };
  }

  const otherOptionNames = decision.options.filter((o) => !o.isChosen).map((o) => o.name);

  const judgment = await judgeAssumptionConflict({
    fact,
    assumption,
    decisionTitle: decision.title,
    otherOptionNames,
  });

  const severity = classifyConflictSeverity({
    relation: judgment.relation,
    confidence: judgment.confidence,
    evidenceAuthority: document.authorityScore,
    assumptionAuthority: assumption.authorityScore,
  });

  const method = judgment.confidence === 1 && judgment.conflictType === "VALUE_CHANGED"
    ? "DETERMINISTIC"
    : "SEMANTIC";

  const baseLog =
    `${scorePrefix} "${assumption.statement}" vs "${fact.statement}" → ` +
    `${judgment.relation} (confidence ${judgment.confidence.toFixed(2)}, ${method.toLowerCase()}). ` +
    `${judgment.explanation}`;

  if (!severity.record || !severity.nextValidity) {
    // Supporting evidence is still worth keeping as provenance even though
    // it changes nothing about the decision's status.
    if (judgment.relation === "SUPPORTS") {
      await createDecisionEvidence({
        tenantId: document.tenantId,
        decisionId: decision.id,
        assumptionId: assumption.id,
        documentId: document.id,
        memoryChunkId: documentChunkId,
        evidenceType: "SUPPORTING",
        relevance: candidate.finalScore,
        excerpt: judgment.sourceQuote || fact.sourceQuote || fact.statement,
      });
    }
    return {
      recorded: false,
      log: `${baseLog} No change: ${severity.reason}`,
      decisionId: decision.id,
      validity: null,
      decisionFlagged: false,
    };
  }

  const evidence = await createDecisionEvidence({
    tenantId: document.tenantId,
    decisionId: decision.id,
    assumptionId: assumption.id,
    documentId: document.id,
    memoryChunkId: documentChunkId,
    evidenceType: "CONTRADICTING",
    relevance: candidate.finalScore,
    excerpt: judgment.sourceQuote || fact.sourceQuote || fact.statement,
  });

  await setAssumptionValidity(assumption.id, severity.nextValidity, {
    invalidatedByEvidenceId: severity.nextValidity === "INVALIDATED" ? evidence.id : null,
  });

  const conflict = await createConflictEvent({
    tenantId: document.tenantId,
    decisionId: decision.id,
    assumptionId: assumption.id,
    documentId: document.id,
    memoryChunkId: documentChunkId,
    agentRunId,
    factStatement: fact.statement,
    explanation: judgment.explanation,
    conflictType: judgment.conflictType,
    relation: judgment.relation,
    confidence: judgment.confidence,
    oldValue: judgment.oldValue,
    newValue: judgment.newValue,
    sourceQuote: judgment.sourceQuote || fact.sourceQuote,
    detectionMethod: method,
    suggestedOptionId:
      decision.options.find(
        (o) => o.name.toLowerCase() === judgment.suggestedOptionName.trim().toLowerCase(),
      )?.id ?? null,
  });

  await recordMemoryEvent({
    tenantId: document.tenantId,
    projectId: decision.projectId,
    entityType: "assumption",
    entityId: assumption.id,
    decisionId: decision.id,
    eventType:
      severity.nextValidity === "INVALIDATED"
        ? "ASSUMPTION_INVALIDATED"
        : "ASSUMPTION_CHALLENGED",
    agentRunId,
    actorType: "AGENT",
    summary: judgment.explanation,
    metadata: {
      conflictId: conflict.id,
      documentId: document.id,
      confidence: judgment.confidence,
      evidenceAuthority: document.authorityScore,
      assumptionAuthority: assumption.authorityScore,
      severityReason: severity.reason,
    },
  });

  let decisionFlagged = false;
  if (severity.flagDecision && decision.status !== "AT_RISK") {
    await updateDecisionStatus(document.tenantId, decision.id, "AT_RISK", {
      riskExplanation: judgment.explanation,
    });
    decisionFlagged = true;

    await recordMemoryEvent({
      tenantId: document.tenantId,
      projectId: decision.projectId,
      entityType: "decision",
      entityId: decision.id,
      decisionId: decision.id,
      eventType: "DECISION_AT_RISK",
      agentRunId,
      actorType: "AGENT",
      summary: judgment.explanation,
      metadata: { conflictId: conflict.id, assumptionId: assumption.id },
    });

    await recordAuditEvent({
      tenantId: document.tenantId,
      actorLabel: "system",
      action: "decision.marked_at_risk",
      entityType: "decision",
      entityId: decision.id,
      metadata: {
        conflictEventId: conflict.id,
        documentId: document.id,
        assumptionId: assumption.id,
        factStatement: fact.statement,
      },
    });
  } else if (severity.flagDecision) {
    decisionFlagged = true; // already at risk; conflict still recorded above
  }

  return {
    recorded: true,
    log: `${baseLog} → assumption ${severity.nextValidity}. ${severity.reason}`,
    decisionId: decision.id,
    validity: severity.nextValidity as "INVALIDATED" | "CHALLENGED",
    decisionFlagged,
  };
}
