import { embedText } from "@/lib/ai/embeddings";
import { searchMemoryChunks } from "@/lib/repo/memoryChunks";
import type {
  MemoryChunkCandidate,
  MemorySourceType,
  ScoredMemoryCandidate,
  ScoringWeights,
} from "@/lib/types";

/**
 * Hybrid memory retrieval (decision.md §16).
 *
 * Vector similarity alone is not enough: a semantically close but
 * unimportant note from an unverified source should not outrank a
 * load-bearing assumption backed by a signed contract. Final score combines
 * four signals, each in [0,1]:
 *
 *   final = w_sem·semantic + w_imp·importance + w_auth·authority + w_ctx·contextual
 *
 * Weights are configurable (env `RETRIEVAL_WEIGHTS`, or per-call) rather
 * than baked in, because §16 explicitly warns against blindly implementing
 * arbitrary weights — see tests/unit/retrievalScoring.test.ts for the
 * behaviour they're chosen to produce.
 */

export const DEFAULT_WEIGHTS: ScoringWeights = {
  semantic: 0.5,
  importance: 0.2,
  authority: 0.15,
  contextual: 0.15,
};

/**
 * Reads weights from `RETRIEVAL_WEIGHTS` as
 * `semantic:0.5,importance:0.2,authority:0.15,contextual:0.15`. Falls back
 * to defaults on absent or malformed input rather than throwing — a bad env
 * var should degrade retrieval quality, not take the app down.
 */
export function resolveWeights(override?: Partial<ScoringWeights>): ScoringWeights {
  const fromEnv: Partial<ScoringWeights> = {};
  const raw = process.env.RETRIEVAL_WEIGHTS;
  if (raw) {
    for (const pair of raw.split(",")) {
      const [key, value] = pair.split(":").map((s) => s.trim());
      const parsed = Number(value);
      if (
        (key === "semantic" ||
          key === "importance" ||
          key === "authority" ||
          key === "contextual") &&
        Number.isFinite(parsed)
      ) {
        fromEnv[key] = parsed;
      }
    }
  }
  return { ...DEFAULT_WEIGHTS, ...fromEnv, ...override };
}

export interface ContextualSignals {
  /** Decision the current action is already anchored to, if any. */
  focusDecisionId?: string | null;
  /** Project scope of the current action. */
  focusProjectId?: string | null;
  /** Session that is doing the retrieving — used to mark cross-session recall. */
  sessionId?: string | null;
  /**
   * Sessions that created each candidate, keyed by chunk id. Absent entries
   * are treated as "unknown origin", which is NOT counted as cross-session —
   * an unproven claim of cross-session recall would undermine the exact
   * thing the Memory Inspector exists to demonstrate.
   */
  originSessionByChunkId?: Record<string, string | null>;
}

/**
 * Contextual relevance: does this memory belong to what we're working on
 * right now? Deliberately *not* a freshness decay — §16 is explicit that
 * old decisions must not be penalised merely for being old. Recency only
 * enters for document evidence, where a newer pricing sheet genuinely
 * supersedes an older one.
 */
export function contextualScore(
  candidate: MemoryChunkCandidate,
  signals: ContextualSignals,
): number {
  let score = 0.4; // baseline: in-tenant and semantically retrieved at all

  if (signals.focusDecisionId && candidate.decisionId === signals.focusDecisionId) {
    score += 0.4;
  }

  if (candidate.sourceType === "assumption") {
    // Assumptions are the memories that can actually be invalidated, so they
    // are the point of most retrievals in this product.
    score += 0.2;
  } else if (candidate.sourceType === "document") {
    // Freshness applies to evidence only: a document from the last 90 days
    // gets up to +0.2, decaying linearly, floored at 0.
    const ageDays = (Date.now() - new Date(candidate.createdAt).getTime()) / 86_400_000;
    score += 0.2 * Math.max(0, 1 - ageDays / 90);
  }

  return Math.min(1, score);
}

export function scoreCandidates(
  candidates: MemoryChunkCandidate[],
  opts: {
    weights?: ScoringWeights;
    signals?: ContextualSignals;
    selectTopK?: number;
    minFinalScore?: number;
  } = {},
): ScoredMemoryCandidate[] {
  const weights = opts.weights ?? resolveWeights();
  const signals = opts.signals ?? {};
  const selectTopK = opts.selectTopK ?? 5;
  const minFinalScore = opts.minFinalScore ?? 0;

  const scored = candidates.map((candidate) => {
    // Cosine similarity is in [-1,1]; clamp to [0,1] so a negative
    // similarity can't drag the weighted sum below zero and reorder things
    // in a way the weights don't describe.
    const semanticScore = Math.max(0, Math.min(1, candidate.similarity));
    const importanceScore = Math.max(0, Math.min(1, candidate.importance));
    const authorityComponent = Math.max(0, Math.min(1, candidate.authorityScore));
    const ctx = contextualScore(candidate, signals);

    const finalScore =
      weights.semantic * semanticScore +
      weights.importance * importanceScore +
      weights.authority * authorityComponent +
      weights.contextual * ctx;

    const originSession = signals.originSessionByChunkId?.[candidate.chunkId];
    const crossSession = Boolean(
      signals.sessionId && originSession && originSession !== signals.sessionId,
    );

    return {
      ...candidate,
      semanticScore,
      importanceScore,
      authorityComponent,
      contextualScore: ctx,
      finalScore,
      selectedForContext: false,
      crossSession,
    };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);

  scored.forEach((candidate, index) => {
    candidate.selectedForContext = index < selectTopK && candidate.finalScore >= minFinalScore;
  });

  return scored;
}

export interface HybridRetrievalResult {
  candidates: ScoredMemoryCandidate[];
  selected: ScoredMemoryCandidate[];
  renderedSql: string;
  latencyMs: number;
  weights: ScoringWeights;
  queryText: string;
}

/**
 * The full retrieve step of the §17 memory pipeline: embed the query,
 * vector-search CockroachDB within the tenant, then re-rank with the hybrid
 * scorer. Callers get both the full candidate list (for the Memory
 * Inspector, including the ones that lost) and the selected subset.
 */
export async function retrieveMemory(
  tenantId: string,
  queryText: string,
  opts: {
    limit?: number;
    sourceType?: MemorySourceType;
    projectId?: string | null;
    excludeSourceId?: string | null;
    weights?: Partial<ScoringWeights>;
    signals?: ContextualSignals;
    selectTopK?: number;
    minFinalScore?: number;
  } = {},
): Promise<HybridRetrievalResult> {
  const weights = resolveWeights(opts.weights);
  const { embedding } = await embedText(queryText);

  const { candidates, renderedSql, latencyMs } = await searchMemoryChunks(
    tenantId,
    embedding,
    {
      limit: opts.limit ?? 10,
      sourceType: opts.sourceType,
      projectId: opts.projectId,
      excludeSourceId: opts.excludeSourceId,
    },
  );

  const scored = scoreCandidates(candidates, {
    weights,
    signals: opts.signals,
    selectTopK: opts.selectTopK,
    minFinalScore: opts.minFinalScore,
  });

  return {
    candidates: scored,
    selected: scored.filter((c) => c.selectedForContext),
    renderedSql,
    latencyMs,
    weights,
    queryText,
  };
}
