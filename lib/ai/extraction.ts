import { getReasoningProvider } from "@/lib/ai/bedrock";
import type { ExtractedFact } from "@/lib/types";

export type { DecisionExtractionResult } from "@/lib/ai/reasoningProvider";

/**
 * Turns freeform decision notes into the structured shape
 * lib/repo/decisions.ts persists — the extraction step of the "Commit
 * Decision" workflow. Thin wrapper over the ReasoningProvider abstraction
 * (lib/ai/reasoningProvider.ts) so callers don't need to know the reasoning
 * transport is Amazon Bedrock (lib/ai/bedrock.ts).
 */
export async function extractDecisionFromNotes(notes: string) {
  return getReasoningProvider().extractDecision(notes);
}

/**
 * Extracts structured, numeric facts from an uploaded document. These facts
 * are what conflict detection (lib/ai/conflict.ts) checks against every
 * stored assumption across the tenant's decisions.
 */
export async function extractFactsFromDocument(text: string): Promise<ExtractedFact[]> {
  return getReasoningProvider().extractFacts(text);
}
