import { getReasoningProvider } from "@/lib/ai/bedrock";
import { tryDeterministicConflictCheck } from "@/lib/ai/deterministic";
import type { Assumption, ExtractedFact } from "@/lib/types";

export type { ConflictJudgment } from "@/lib/ai/reasoningProvider";

/**
 * The judgment call at the center of automatic assumption invalidation:
 * given one new fact and one previously-stored assumption (found via vector
 * retrieval, not told to be related), does the fact make the assumption
 * false? Thin wrapper over the ReasoningProvider abstraction
 * (lib/ai/reasoningProvider.ts). A deterministic structured comparison runs
 * first, independent of the provider (decision.md §21: "price < 25000 vs
 * price = 42000 should not require an LLM"); only unstructured or
 * cross-metric cases reach the model.
 */
export async function judgeAssumptionConflict(input: {
  fact: ExtractedFact;
  assumption: Assumption;
  decisionTitle: string;
  otherOptionNames: string[];
}) {
  const deterministic = tryDeterministicConflictCheck(input);
  if (deterministic) return deterministic;
  const judgment = await getReasoningProvider().analyzeConflict(input);
  return { ...judgment, method: "SEMANTIC" as const };
}
