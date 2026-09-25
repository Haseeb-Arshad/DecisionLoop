import { z } from "zod";
import { OPERATORS, VALUE_TYPES } from "./model";

/**
 * A fact is one observation about the world, extracted from (or supplied
 * with) a piece of evidence. Facts are what assumptions are checked against.
 *
 * Both numeric facts ("SignalForge costs $42,000/year") and qualitative
 * facts ("SignalForge discontinued EU hosting", "redis was removed from
 * package.json") are first-class — the 1.x pipeline only understood the
 * former (docs/v2/00-audit-and-plan.md §4.3).
 *
 * Every fact carries its own provenance: where in the source it came from,
 * the verbatim quote, and what extracted it. Evidence-level provenance
 * (source, authority, content hash, timestamps) lives on the evidence item
 * that contains the fact.
 */
export const factSchema = z.object({
  subject: z.string().max(200).nullish(),
  predicate: z.string().min(1).max(200),
  valueType: z.enum(VALUE_TYPES),
  value: z.union([z.number(), z.boolean(), z.string(), z.array(z.string())]),
  /**
   * How the source stated the value. Only `=` facts are compared
   * deterministically — "costs under $30k" does not tell us whether a
   * `< 25000` assumption still holds.
   */
  operator: z.enum(OPERATORS).default("="),
  unit: z.string().max(60).nullish(),
  statement: z.string().min(1).max(1000),
  quote: z.string().max(2000).nullish(),
  /** Page, line range, file path, PR number — whatever locates the quote. */
  location: z.string().max(300).nullish(),
  observedAt: z.string().nullish(),
  /** e.g. `engineering/manifest-diff`, `bedrock:<model>`, `agent-supplied`, `human`. */
  extractor: z.string().max(200).nullish(),
  /** Confidence that the fact was extracted correctly, not that it is true. */
  confidence: z.number().min(0).max(1).default(1),
});

export type FactInput = z.input<typeof factSchema>;
export type Fact = z.output<typeof factSchema>;

/** The 1.x numeric fact shape produced by `ReasoningProvider.extractFacts`. */
export interface LegacyExtractedFact {
  subject: string;
  metric: string;
  operator: "<" | "<=" | ">" | ">=" | "=";
  value: number;
  unit: string;
  statement: string;
  sourceQuote: string;
}

export function fromLegacyFact(fact: LegacyExtractedFact, extractor?: string | null): Fact {
  return factSchema.parse({
    subject: fact.subject || null,
    predicate: fact.metric,
    valueType: "NUMBER",
    value: fact.value,
    operator: fact.operator,
    unit: fact.unit || null,
    statement: fact.statement,
    quote: fact.sourceQuote || null,
    extractor: extractor ?? null,
  });
}
