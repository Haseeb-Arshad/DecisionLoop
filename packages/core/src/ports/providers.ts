import type { Fact } from "../assumptions/facts";
import type { EvidenceRelation } from "../types/domain";

/**
 * Model provider ports (spec §17). Deterministic reasoning — arithmetic,
 * comparisons, status transitions — never goes through these.
 */

export interface EmbeddingProvider {
  /** Stored with every vector; retrieval only compares vectors from the same model. */
  readonly modelName: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface SemanticJudgmentInput {
  decisionTitle: string;
  assumption: {
    statement: string;
    subject: string | null;
    predicate: string | null;
    structured: string | null;
  };
  /** A structured fact, when there is one. */
  fact: Fact | null;
  /** Untrusted evidence text; wrapped in the injection boundary by the provider. */
  evidenceText: string | null;
}

export interface SemanticJudgment {
  relation: EvidenceRelation;
  confidence: number;
  explanation: string;
  /** Verbatim quote from the evidence supporting the judgment. */
  quote: string;
}

export interface ReasoningProvider {
  /** e.g. `bedrock:us.anthropic.claude-…`, `openai:gpt-…`. Recorded as the extractor. */
  readonly name: string;
  /**
   * Numeric and qualitative facts from untrusted text, each with a verbatim
   * quote. Must treat the text as data, never as instructions.
   */
  extractFacts(text: string, hints?: { subjects?: string[]; predicates?: string[] }): Promise<Fact[]>;
  /** Judges one assumption against one piece of evidence. Called only when deterministic evaluation declined. */
  judge(input: SemanticJudgmentInput): Promise<SemanticJudgment>;
}

/**
 * Used when no model is configured. Semantic evaluation is recorded as
 * UNAVAILABLE — never faked — and changes nothing.
 */
export class NoReasoningProvider implements ReasoningProvider {
  readonly name = "none";
  async extractFacts(): Promise<Fact[]> {
    return [];
  }
  async judge(): Promise<SemanticJudgment> {
    throw new ReasoningUnavailableError();
  }
}

export class ReasoningUnavailableError extends Error {
  constructor() {
    super("No reasoning provider is configured; semantic evaluation is unavailable.");
    this.name = "ReasoningUnavailableError";
  }
}
