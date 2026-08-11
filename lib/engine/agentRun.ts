import { completeAgentRun, startAgentRun } from "@/lib/repo/agentRuns";
import { childLogger } from "@/lib/logger";
import type { AgentIntent, AgentRun } from "@/lib/types";

const log = childLogger({ module: "agentRun" });

/**
 * The §17 memory pipeline, as executable structure rather than prose:
 *
 *   INPUT → INTENT ANALYSIS → RETRIEVE MEMORY → REASON USING MEMORY
 *         → TAKE/RECOMMEND ACTION → OBSERVE RESULT → WRITE MEMORY → AUDIT
 *
 * Every major agent execution runs inside `withAgentRun`, which opens an
 * `agent_runs` row up front and closes it with real timings and counters —
 * so the lifecycle is queryable afterwards (Memory Inspector, observability
 * dashboard) instead of only existing in a log line. A throw still closes
 * the run, marked FAILED with the error attached; runs are never left
 * dangling in RUNNING because something blew up mid-pipeline.
 */

export interface AgentRunContext {
  run: AgentRun;
  /** Counters the pipeline updates as it goes; flushed on completion. */
  stats: {
    memoriesRetrieved: number;
    memoriesWritten: number;
    conflictsDetected: number;
    retrievalLatencyMs: number;
  };
  recordRetrieval(latencyMs: number, count: number): void;
  recordWrites(count: number): void;
  recordConflicts(count: number): void;
}

export async function withAgentRun<T>(
  input: {
    tenantId: string;
    projectId?: string | null;
    sessionId: string;
    intent: AgentIntent;
    request?: string | null;
    model?: string | null;
    createdBy?: string | null;
  },
  fn: (ctx: AgentRunContext) => Promise<{ result: T; outputSummary?: string }>,
): Promise<{ result: T; run: AgentRun }> {
  const startedAt = Date.now();
  const run = await startAgentRun(input);

  const ctx: AgentRunContext = {
    run,
    stats: {
      memoriesRetrieved: 0,
      memoriesWritten: 0,
      conflictsDetected: 0,
      retrievalLatencyMs: 0,
    },
    recordRetrieval(latencyMs, count) {
      // Accumulated, not overwritten: one ingestion run performs a separate
      // retrieval per extracted fact, and the observability dashboard's
      // "average retrieval latency" is only meaningful if every one counts.
      ctx.stats.retrievalLatencyMs += latencyMs;
      ctx.stats.memoriesRetrieved += count;
    },
    recordWrites(count) {
      ctx.stats.memoriesWritten += count;
    },
    recordConflicts(count) {
      ctx.stats.conflictsDetected += count;
    },
  };

  try {
    const { result, outputSummary } = await fn(ctx);

    await completeAgentRun(run.id, {
      status: "SUCCEEDED",
      latencyMs: Date.now() - startedAt,
      retrievalLatencyMs: ctx.stats.retrievalLatencyMs || null,
      memoriesRetrieved: ctx.stats.memoriesRetrieved,
      memoriesWritten: ctx.stats.memoriesWritten,
      conflictsDetected: ctx.stats.conflictsDetected,
      outputSummary: outputSummary ?? null,
    });

    log.info(
      {
        agentRunId: run.id,
        intent: input.intent,
        latencyMs: Date.now() - startedAt,
        ...ctx.stats,
      },
      "agent run completed",
    );

    return { result, run };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await completeAgentRun(run.id, {
      status: "FAILED",
      latencyMs: Date.now() - startedAt,
      retrievalLatencyMs: ctx.stats.retrievalLatencyMs || null,
      memoriesRetrieved: ctx.stats.memoriesRetrieved,
      memoriesWritten: ctx.stats.memoriesWritten,
      conflictsDetected: ctx.stats.conflictsDetected,
      error: message,
    });

    log.error({ err, agentRunId: run.id, intent: input.intent }, "agent run failed");
    throw err;
  }
}

/**
 * Stable per-browser-session identifier for agent runs. The cross-session
 * memory claim depends on this being genuinely different between the
 * "session 1" and "session 2" halves of the demo, so it's derived from the
 * auth session id rather than a per-request random value.
 */
export function sessionIdFor(authSessionId: string): string {
  return `sess_${authSessionId.slice(0, 12)}`;
}
