import type {
  Assumption,
  AssumptionOperator,
  AssumptionType,
  ConflictType,
  EvidenceRelation,
  ExtractedFact,
} from "@/lib/types";

/**
 * The AI provider abstraction decision.md §28 asks for — reasoning is
 * reached through this interface everywhere in the app, so the transport is
 * swappable without touching call sites. `BedrockReasoningProvider`
 * (lib/ai/bedrock.ts) is the only implementation: DecisionLoop's reasoning
 * and structured extraction run through Amazon Bedrock.
 */

export interface DecisionExtractionResult {
  title: string;
  problemStatement: string;
  reasoning: string;
  confidence: number;
  options: Array<{
    name: string;
    description: string;
    isChosen: boolean;
    rejectionReason: string;
  }>;
  assumptions: Array<{
    statement: string;
    assumptionType: AssumptionType;
    metric: string;
    operator?: AssumptionOperator;
    value?: number;
    unit: string;
    importance: number;
    confidence: number;
  }>;
  risks: string[];
  evidenceReferences: Array<{
    quote: string;
    supports: string;
  }>;
}

export interface ConflictAnalysisInput {
  fact: ExtractedFact;
  assumption: Assumption;
  decisionTitle: string;
  otherOptionNames: string[];
}

/**
 * §21 requires every conflict analysis to return the relation, a
 * confidence, an explanation, and the source quote — not merely a boolean.
 */
export interface ConflictJudgment {
  relation: EvidenceRelation;
  conflictType: ConflictType;
  confidence: number;
  explanation: string;
  oldValue: string;
  newValue: string;
  sourceQuote: string;
  suggestedOptionName: string;
}

export interface MemoryAnswerInput {
  question: string;
  /** Retrieved memory, already selected by the hybrid scorer. */
  memories: Array<{
    kind: string;
    reference: string;
    content: string;
  }>;
}

/**
 * §41 — if there is no relevant organizational memory, the agent must say
 * so rather than inventing history. `groundedInMemory: false` is the
 * machine-checkable form of that admission, and the UI renders it
 * differently from a grounded answer.
 */
export interface MemoryAnswer {
  answer: string;
  groundedInMemory: boolean;
  citedReferences: string[];
  followUpSuggestion: string;
}

export interface ReasoningProvider {
  /** Turns freeform decision notes and/or documents into a structured record. */
  extractDecision(notes: string): Promise<DecisionExtractionResult>;
  /** Extracts concrete, numeric facts from an uploaded document's text. */
  extractFacts(documentText: string): Promise<ExtractedFact[]>;
  /** Judges how a new fact relates to a previously-stored assumption. */
  analyzeConflict(input: ConflictAnalysisInput): Promise<ConflictJudgment>;
  /** Answers a question strictly from retrieved memory, or admits it can't. */
  answerWithMemory(input: MemoryAnswerInput): Promise<MemoryAnswer>;
}
