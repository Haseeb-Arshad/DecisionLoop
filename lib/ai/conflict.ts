import { getReasoningProvider } from "@/lib/ai/bedrock";
import type { Assumption, ExtractedFact } from "@/lib/types";

export type { ConflictJudgment } from "@/lib/ai/reasoningProvider";

/**
 * The judgment call at the center of automatic assumption invalidation:
 * given one new fact and one previously-stored assumption (found via vector
 * retrieval, not told to be related), does the fact make the assumption
 * false? Thin wrapper over the ReasoningProvider abstraction
 * (lib/ai/reasoningProvider.ts) — the provider itself
 * (lib/ai/bedrock.ts#BedrockReasoningProvider) tries a deterministic
 * structured comparison first (decision.md §21: "price < 25000 vs price =
 * 42000 should not require an LLM") and only calls the model for
 * unstructured or cross-metric cases.
 */
export async function judgeAssumptionConflict(input: {
  fact: ExtractedFact;
  assumption: Assumption;
  decisionTitle: string;
  otherOptionNames: string[];
}) {
  return getReasoningProvider().analyzeConflict(input);
}
