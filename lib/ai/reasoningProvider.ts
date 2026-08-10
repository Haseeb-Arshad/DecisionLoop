import type { Assumption, AssumptionOperator, ExtractedFact } from "@/lib/types";

/**
 * The AI provider abstraction decision.md §28 asks for — reasoning is
 * reached through this interface everywhere in the app (lib/ai/extraction.ts,
 * lib/ai/conflict.ts are thin wrappers over it), so the transport is
 * swappable without touching call sites. BedrockReasoningProvider
 * (lib/ai/bedrock.ts) is the only implementation: DecisionLoop's reasoning
 * and structured extraction run through Amazon Bedrock, not a direct
 * Anthropic API call — see docs/architecture.md §3.
 */
export interface DecisionExtractionResult {
  title: string;
  problemStatement: string;
  reasoning: string;
  options: Array<{
    name: string;
    description: string;
    isChosen: boolean;
    rejectionReason: string;
  }>;
  assumptions: Array<{
    statement: string;
    metric: string;
    operator: AssumptionOperator;
    value: number;
    unit: string;
  }>;
}

export interface ConflictAnalysisInput {
  fact: ExtractedFact;
  assumption: Assumption;
  decisionTitle: string;
  otherOptionNames: string[];
}

export interface ConflictJudgment {
  invalidated: boolean;
  explanation: string;
  suggestedOptionName: string;
}

export interface ReasoningProvider {
  /** Turns freeform decision notes into the structured (options, assumptions) shape. */
  extractDecision(notes: string): Promise<DecisionExtractionResult>;
  /** Extracts concrete, numeric facts from an uploaded document's text. */
  extractFacts(documentText: string): Promise<ExtractedFact[]>;
  /** Judges whether a new fact invalidates a previously-stored assumption. */
  analyzeConflict(input: ConflictAnalysisInput): Promise<ConflictJudgment>;
}
