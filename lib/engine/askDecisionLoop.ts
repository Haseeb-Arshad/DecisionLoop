import { getReasoningProvider } from "@/lib/ai/bedrock";
import { withAgentRun } from "@/lib/engine/agentRun";
import { retrieveMemory } from "@/lib/engine/retrieval";
import { recordRetrievalEvents } from "@/lib/repo/agentRuns";
import { getAssumptionById, getDecisionById } from "@/lib/repo/decisions";
import { getMemoryChunksByIds } from "@/lib/repo/memoryChunks";
import { recordMemoryEvent } from "@/lib/repo/memoryEvents";
import { recordMemoryTrace } from "@/lib/repo/memoryTraces";
import type { MemoryAnswer } from "@/lib/ai/reasoningProvider";
import type { ScoredMemoryCandidate } from "@/lib/types";

export interface AskResult {
  answer: MemoryAnswer;
  agentRunId: string;
  memoryTraceId: string;
  candidates: ScoredMemoryCandidate[];
  usedChunkIds: string[];
  retrievalLatencyMs: number;
}

/**
 * "Ask DecisionLoop" (§40–§41): answers a question strictly from
 * retrieved organizational memory, and admits it when the memory isn't
 * there rather than inventing history.
 *
 * The no-hallucination guarantee is structural, not just prompted: the
 * model is only ever shown memories that were actually retrieved from
 * CockroachDB in this run, each labelled with a reference the answer must
 * cite, and the `groundedInMemory` flag it returns is rendered differently
 * in the UI. Every run leaves an agent_run + memory_trace behind, so any
 * answer can be traced back to the exact rows that produced it.
 */
export async function askDecisionLoop(input: {
  tenantId: string;
  sessionId: string;
  question: string;
  projectId?: string | null;
  focusDecisionId?: string | null;
  userId?: string | null;
}): Promise<AskResult> {
  const { result } = await withAgentRun(
    {
      tenantId: input.tenantId,
      projectId: input.projectId ?? null,
      sessionId: input.sessionId,
      intent: "ANSWER_QUESTION",
      request: input.question,
      createdBy: input.userId ?? null,
    },
    async (ctx) => {
      const retrieval = await retrieveMemory(input.tenantId, input.question, {
        limit: 12,
        projectId: input.projectId ?? null,
        signals: {
          focusDecisionId: input.focusDecisionId ?? null,
          focusProjectId: input.projectId ?? null,
          sessionId: input.sessionId,
          originSessionByChunkId: {},
        },
        selectTopK: 6,
        minFinalScore: 0.3,
      });

      ctx.recordRetrieval(retrieval.latencyMs, retrieval.candidates.length);

      // Hydrate the selected chunks into labelled context. Labels are what
      // the model must cite, so they have to be stable and human-meaningful
      // — the Memory Inspector shows the same labels next to the same rows.
      const selectedChunks = await getMemoryChunksByIds(
        input.tenantId,
        retrieval.selected.map((c) => c.chunkId),
      );

      const memories = await Promise.all(
        selectedChunks.map(async (chunk, index) => {
          const reference = `M${index + 1}`;
          let kind = chunk.sourceType as string;

          if (chunk.sourceType === "assumption") {
            const assumption = await getAssumptionById(chunk.sourceId);
            if (assumption) {
              kind = `assumption · ${assumption.validityStatus}`;
            }
          } else if (chunk.sourceType === "decision") {
            const decision = await getDecisionById(input.tenantId, chunk.sourceId);
            if (decision) kind = `decision · ${decision.status}`;
          }

          return { kind, reference, content: chunk.content, chunkId: chunk.id };
        }),
      );

      const answer = await getReasoningProvider().answerWithMemory({
        question: input.question,
        memories: memories.map(({ kind, reference, content }) => ({
          kind,
          reference,
          content,
        })),
      });

      // Only the memories the answer actually cited are marked as used —
      // "retrieved" and "used in reasoning" are different claims, and §23
      // requires the Inspector to distinguish them.
      const citedRefs = new Set(answer.citedReferences);
      const usedChunkIds = memories
        .filter((m) => citedRefs.has(m.reference))
        .map((m) => m.chunkId);

      const trace = await recordMemoryTrace({
        tenantId: input.tenantId,
        agentRunId: ctx.run.id,
        actionType: "answer",
        relatedDecisionId: input.focusDecisionId ?? null,
        queryText: input.question,
        renderedSql: retrieval.renderedSql,
        candidates: retrieval.candidates,
        usedChunkIds,
        retrievalLatencyMs: retrieval.latencyMs,
        scoringWeights: retrieval.weights,
        llmReasoning: answer.groundedInMemory
          ? `Answered from ${usedChunkIds.length} cited memory/memories (${answer.citedReferences.join(", ") || "none"}).\n\n${answer.answer}`
          : `No grounded answer available from stored memory. Model response:\n\n${answer.answer}`,
      });

      await recordRetrievalEvents({
        tenantId: input.tenantId,
        agentRunId: ctx.run.id,
        memoryTraceId: trace.id,
        candidates: retrieval.candidates,
      });

      for (const chunk of selectedChunks) {
        if (!usedChunkIds.includes(chunk.id)) continue;
        await recordMemoryEvent({
          tenantId: input.tenantId,
          projectId: chunk.projectId,
          entityType: "memory_chunk",
          entityId: chunk.id,
          decisionId: chunk.decisionId,
          eventType: "MEMORY_REFERENCED",
          agentRunId: ctx.run.id,
          actorType: "AGENT",
          actorUserId: input.userId ?? null,
          summary: `Referenced while answering: "${input.question.slice(0, 120)}"`,
        });
      }

      return {
        result: {
          answer,
          agentRunId: ctx.run.id,
          memoryTraceId: trace.id,
          candidates: retrieval.candidates,
          usedChunkIds,
          retrievalLatencyMs: retrieval.latencyMs,
        },
        outputSummary: answer.groundedInMemory
          ? `Answered from ${usedChunkIds.length} memory/memories.`
          : "No relevant organizational memory found; declined to speculate.",
      };
    },
  );

  return result;
}
