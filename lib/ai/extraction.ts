import { getReasoningProvider } from "@/lib/ai/bedrock";
import type { ExtractedFact } from "@/lib/types";

export type { DecisionExtractionResult } from "@/lib/ai/reasoningProvider";

/**
 * Turns decision notes and/or attached document text into the structured
 * shape lib/repo/decisions.ts persists — the extraction step of the
 * "Commit Decision" workflow (§18). Thin wrapper over the ReasoningProvider
 * abstraction so callers don't need to know the transport is Bedrock.
 */
export async function extractDecisionFromNotes(notes: string) {
  return getReasoningProvider().extractDecision(notes);
}

/**
 * Extracts structured, numeric facts from an uploaded document. These facts
 * are what conflict detection checks against every stored assumption across
 * the tenant's decisions.
 */
export async function extractFactsFromDocument(text: string): Promise<ExtractedFact[]> {
  return getReasoningProvider().extractFacts(text);
}
