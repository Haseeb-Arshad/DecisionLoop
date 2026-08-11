import { z } from "zod";

// JSON schemas for every structured Bedrock call (lib/ai/bedrock.ts), each
// paired with a Zod validator. §19 requires that important AI output is
// never parsed from arbitrary prose AND that malformed output can't crash
// the application — the JSON schema constrains generation, the Zod schema
// is the runtime check that the constraint actually held.
//
// Note the JSON Schema subset Bedrock structured outputs supports: no
// numeric `minimum`/`maximum`, no `minLength`/`maxLength`. Ranges are
// therefore stated in field descriptions for the model and enforced by Zod
// (which clamps rather than rejects, so a slightly out-of-range confidence
// degrades gracefully instead of failing an entire ingestion).

const OPERATORS = ["<", "<=", ">", ">=", "="] as const;
const ASSUMPTION_TYPES = [
  "QUANTITATIVE",
  "QUALITATIVE",
  "REGULATORY",
  "CAPACITY",
  "TEMPORAL",
] as const;
const RELATIONS = ["SUPPORTS", "CONTRADICTS", "UPDATES", "IRRELEVANT", "UNCERTAIN"] as const;
const CONFLICT_TYPES = [
  "VALUE_CHANGED",
  "POLICY_CHANGED",
  "CONSTRAINT_CHANGED",
  "EVIDENCE_CONTRADICTS",
  "ASSUMPTION_EXPIRED",
  "OUTCOME_DISPROVES",
] as const;

const unitInterval = z.coerce
  .number()
  .transform((n) => Math.max(0, Math.min(1, n)))
  .catch(0.5);

// ── Decision extraction ─────────────────────────────────────────────────────

export const extractDecisionSchema = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Short (< 12 words) title, e.g. 'Analytics vendor: SignalForge vs MetricLake'.",
    },
    problemStatement: {
      type: "string",
      description: "One or two sentences on what problem this decision solves.",
    },
    reasoning: {
      type: "string",
      description: "Why the chosen option won, in the source's own terms.",
    },
    confidence: {
      type: "number",
      description: "0.0–1.0 confidence that this recommendation is correct given the evidence.",
    },
    options: {
      type: "array",
      minItems: 1,
      description: "Every alternative considered, including the chosen one.",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          isChosen: { type: "boolean" },
          rejectionReason: {
            type: "string",
            description: "Why this option was NOT chosen. Empty string for the chosen option.",
          },
        },
        required: ["name", "description", "isChosen", "rejectionReason"],
        additionalProperties: false,
      },
    },
    assumptions: {
      type: "array",
      description:
        "Concrete, checkable assumptions the decision depends on — the kind that could later " +
        "become false. Prefer ones with a clear metric/operator/value/unit (e.g. 'annual price " +
        "stays under $25,000'). Extract at least one if the input gives any basis for one.",
      items: {
        type: "object",
        properties: {
          statement: {
            type: "string",
            description: "Human-readable form, e.g. 'SignalForge pricing stays under $25,000/year'.",
          },
          assumptionType: { type: "string", enum: [...ASSUMPTION_TYPES] },
          metric: { type: "string", description: "Machine-friendly metric name, e.g. 'annual_price'." },
          operator: { type: "string", enum: [...OPERATORS] },
          value: { type: "number" },
          unit: { type: "string", description: "e.g. 'USD/year', 'events/day', 'ms', '%'." },
          importance: {
            type: "number",
            description: "0.0–1.0. How load-bearing is this assumption? If it fails, does the decision fail?",
          },
          confidence: { type: "number", description: "0.0–1.0 confidence this assumption is true today." },
        },
        required: [
          "statement",
          "assumptionType",
          "metric",
          "operator",
          "value",
          "unit",
          "importance",
          "confidence",
        ],
        additionalProperties: false,
      },
    },
    risks: {
      type: "array",
      description: "Risks a reviewer should weigh before committing this decision.",
      items: { type: "string" },
    },
    evidenceReferences: {
      type: "array",
      description: "Short verbatim quotes from the source material that justify the recommendation.",
      items: {
        type: "object",
        properties: {
          quote: { type: "string", description: "Verbatim excerpt from the supplied material." },
          supports: { type: "string", description: "Which claim or assumption this quote supports." },
        },
        required: ["quote", "supports"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "title",
    "problemStatement",
    "reasoning",
    "confidence",
    "options",
    "assumptions",
    "risks",
    "evidenceReferences",
  ],
  additionalProperties: false,
} as const;

export const decisionExtractionValidator = z.object({
  title: z.string().min(1),
  problemStatement: z.string().default(""),
  reasoning: z.string().default(""),
  confidence: unitInterval,
  options: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().default(""),
        isChosen: z.boolean(),
        rejectionReason: z.string().default(""),
      }),
    )
    .min(1),
  assumptions: z
    .array(
      z.object({
        statement: z.string().min(1),
        assumptionType: z.enum(ASSUMPTION_TYPES).catch("QUANTITATIVE"),
        metric: z.string().default(""),
        operator: z.enum(OPERATORS).catch("="),
        value: z.coerce.number().catch(0),
        unit: z.string().default(""),
        importance: unitInterval,
        confidence: unitInterval,
      }),
    )
    .default([]),
  risks: z.array(z.string()).default([]),
  evidenceReferences: z
    .array(z.object({ quote: z.string(), supports: z.string().default("") }))
    .default([]),
});

// ── Fact extraction ─────────────────────────────────────────────────────────

export const extractFactsSchema = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      description:
        "Every concrete, checkable fact in the document that has a subject, a metric, and a " +
        "numeric value — the kind that could confirm or contradict a stored assumption (pricing, " +
        "SLAs, latency, capacity, dates, percentages). Skip vague or non-numeric claims.",
      items: {
        type: "object",
        properties: {
          subject: { type: "string", description: "What/who the fact is about, e.g. 'SignalForge'." },
          metric: { type: "string", description: "Machine-friendly metric name, e.g. 'annual_price'." },
          operator: {
            type: "string",
            enum: [...OPERATORS],
            description: "'=' for a stated value; an inequality only if the text states a bound.",
          },
          value: { type: "number" },
          unit: { type: "string" },
          statement: { type: "string", description: "The fact in plain language." },
          sourceQuote: {
            type: "string",
            description: "Short verbatim excerpt from the document containing this fact.",
          },
        },
        required: ["subject", "metric", "operator", "value", "unit", "statement", "sourceQuote"],
        additionalProperties: false,
      },
    },
  },
  required: ["facts"],
  additionalProperties: false,
} as const;

export const factsValidator = z.object({
  facts: z
    .array(
      z.object({
        subject: z.string().default(""),
        metric: z.string().default(""),
        operator: z.enum(OPERATORS).catch("="),
        value: z.coerce.number(),
        unit: z.string().default(""),
        statement: z.string().min(1),
        sourceQuote: z.string().default(""),
      }),
    )
    .default([]),
});

// ── Conflict analysis ───────────────────────────────────────────────────────

export const conflictJudgmentSchema = {
  type: "object",
  properties: {
    relation: {
      type: "string",
      enum: [...RELATIONS],
      description:
        "How the new fact relates to the stored assumption. CONTRADICTS = the assumption is now " +
        "false. UPDATES = the value changed but the assumption still holds. SUPPORTS = confirms " +
        "it. IRRELEVANT = different subject or metric. UNCERTAIN = cannot tell from what's given.",
    },
    conflictType: { type: "string", enum: [...CONFLICT_TYPES] },
    confidence: {
      type: "number",
      description: "0.0–1.0 confidence in the stated relation. Be conservative when unsure.",
    },
    explanation: {
      type: "string",
      description:
        "One or two sentences a person would read on the decision page: state the old assumption, " +
        "the new fact, and why they conflict (or don't). Be specific with numbers.",
    },
    oldValue: { type: "string", description: "The assumption's value as previously recorded." },
    newValue: { type: "string", description: "The value the new evidence states." },
    sourceQuote: { type: "string", description: "Verbatim excerpt from the evidence." },
    suggestedOptionName: {
      type: "string",
      description:
        "If this contradiction makes a previously-rejected option worth reconsidering, its exact " +
        "name from the list given. Empty string otherwise.",
    },
  },
  required: [
    "relation",
    "conflictType",
    "confidence",
    "explanation",
    "oldValue",
    "newValue",
    "sourceQuote",
    "suggestedOptionName",
  ],
  additionalProperties: false,
} as const;

export const conflictJudgmentValidator = z.object({
  relation: z.enum(RELATIONS).catch("UNCERTAIN"),
  conflictType: z.enum(CONFLICT_TYPES).catch("EVIDENCE_CONTRADICTS"),
  confidence: unitInterval,
  explanation: z.string().default(""),
  oldValue: z.string().default(""),
  newValue: z.string().default(""),
  sourceQuote: z.string().default(""),
  suggestedOptionName: z.string().default(""),
});

// ── Memory-grounded answers ─────────────────────────────────────────────────

export const memoryAnswerSchema = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      description:
        "The answer, in plain language, citing the reference labels of the memories used. If the " +
        "supplied memories do not contain the answer, say so explicitly and do not speculate.",
    },
    groundedInMemory: {
      type: "boolean",
      description:
        "True ONLY if the supplied memories actually contain the answer. False if you had to rely " +
        "on general knowledge or could not answer — never guess organizational history.",
    },
    citedReferences: {
      type: "array",
      description: "Reference labels (exactly as supplied) of the memories the answer relies on.",
      items: { type: "string" },
    },
    followUpSuggestion: {
      type: "string",
      description: "One concrete next step for the user, or an empty string.",
    },
  },
  required: ["answer", "groundedInMemory", "citedReferences", "followUpSuggestion"],
  additionalProperties: false,
} as const;

export const memoryAnswerValidator = z.object({
  answer: z.string().min(1),
  groundedInMemory: z.boolean().catch(false),
  citedReferences: z.array(z.string()).default([]),
  followUpSuggestion: z.string().default(""),
});
