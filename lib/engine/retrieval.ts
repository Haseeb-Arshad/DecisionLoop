import { embedText } from "@/lib/ai/embeddings";
import { searchMemoryChunks } from "@/lib/repo/memoryChunks";
import { resolveWeights, scoreCandidates } from "@decisionloop/core/retrieval/scoring";
import type { ContextualSignals } from "@decisionloop/core/retrieval/scoring";
import type {
  MemorySourceType,
  ScoredMemoryCandidate,
  ScoringWeights,
} from "@/lib/types";

// The pure scoring half of retrieval moved to @decisionloop/core; re-exported
// so existing imports (and tests) keep working.
export {
  DEFAULT_WEIGHTS,
  contextualScore,
  resolveWeights,
  scoreCandidates,
} from "@decisionloop/core/retrieval/scoring";
export type { ContextualSignals } from "@decisionloop/core/retrieval/scoring";

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
