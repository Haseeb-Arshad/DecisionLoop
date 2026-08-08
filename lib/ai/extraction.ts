import { callClaudeStructured } from "@/lib/ai/anthropic";
import type { AssumptionOperator, ExtractedFact } from "@/lib/types";

const DECISION_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Short (< 12 words) title for the decision, e.g. 'Workflow tool: SignalForge vs MetricLake'.",
    },
    problemStatement: {
      type: "string",
      description: "One or two sentences on what problem this decision solves.",
    },
    reasoning: {
      type: "string",
      description: "The reasoning behind the chosen option, in the user's own terms — why it won.",
    },
    options: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          isChosen: { type: "boolean" },
          rejectionReason: {
            type: "string",
            description: "Why this option was NOT chosen. Empty string if this is the chosen option.",
          },
        },
        required: ["name", "description", "isChosen", "rejectionReason"],
        additionalProperties: false,
      },
    },
    assumptions: {
      type: "array",
      description:
        "Concrete, checkable assumptions the decision depends on — the kind that could later become false. " +
        "Prefer ones with a clear metric/operator/value/unit (e.g. 'annual price stays under $25,000'). " +
        "Extract at least one if the input gives any basis for one.",
      items: {
        type: "object",
        properties: {
          statement: { type: "string", description: "Human-readable form, e.g. 'SignalForge pricing stays under $25,000/year'." },
          metric: { type: "string", description: "Short machine-friendly metric name, e.g. 'annual_price'." },
          operator: { type: "string", enum: ["<", "<=", ">", ">=", "="] },
          value: { type: "number" },
          unit: { type: "string", description: "e.g. 'USD/year', 'ms', '%'." },
        },
        required: ["statement", "metric", "operator", "value", "unit"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "problemStatement", "reasoning", "options", "assumptions"],
  additionalProperties: false,
} as const;

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

/**
 * Turns freeform decision notes (a short description of options considered
 * and the reasoning) into the structured shape lib/repo/decisions.ts persists.
 * This is the extraction step of the "Commit Decision" workflow — see
 * app/(app)/decisions/new for where the user reviews/edits this before it's
 * written to CockroachDB.
 */
export async function extractDecisionFromNotes(
  notes: string,
): Promise<DecisionExtractionResult> {
  return callClaudeStructured<DecisionExtractionResult>({
    system:
      "You extract structured decision records from a person's freeform notes about a choice " +
      "they made. Be faithful to what they wrote — don't invent options or numbers they didn't " +
      "mention. If they give a concrete number (a price, a latency, a percentage) that the " +
      "decision depends on, capture it as an assumption with a metric/operator/value/unit — " +
      "that structure is what lets the system later notice if the number stops being true.",
    prompt: `Decision notes:\n\n${notes}`,
    schema: DECISION_EXTRACTION_SCHEMA,
    effort: "high",
  });
}

const FACT_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      description:
        "Every concrete, checkable fact in the document that includes a subject, a metric, and a " +
        "numeric value — the kind of fact that could confirm or contradict a stored assumption " +
        "(pricing, SLAs, latency, capacity, dates, percentages). Skip vague or non-numeric claims.",
      items: {
        type: "object",
        properties: {
          subject: { type: "string", description: "What/who the fact is about, e.g. 'SignalForge'." },
          metric: { type: "string", description: "Short machine-friendly metric name, e.g. 'annual_price'." },
          operator: {
            type: "string",
            enum: ["<", "<=", ">", ">=", "="],
            description: "'=' for a stated value; use </<=/>/>= only for an explicit bound stated in the text.",
          },
          value: { type: "number" },
          unit: { type: "string" },
          statement: { type: "string", description: "The fact in plain language, quoting or closely paraphrasing the source." },
        },
        required: ["subject", "metric", "operator", "value", "unit", "statement"],
        additionalProperties: false,
      },
    },
  },
  required: ["facts"],
  additionalProperties: false,
} as const;

/**
 * Extracts structured, numeric facts from an uploaded document. These facts
 * are what conflict detection (lib/ai/conflict.ts) checks against every
 * stored assumption across the tenant's decisions — the document never says
 * which decision it relates to; retrieval finds that connection.
 */
export async function extractFactsFromDocument(text: string): Promise<ExtractedFact[]> {
  // Cap input size defensively — this is a hackathon build, not a
  // full document-chunking pipeline; long documents get truncated rather
  // than silently failing the request.
  const truncated = text.length > 24000 ? `${text.slice(0, 24000)}\n\n[...truncated]` : text;

  const result = await callClaudeStructured<{ facts: ExtractedFact[] }>({
    system:
      "You extract concrete, numeric facts from business documents (pricing sheets, SLAs, " +
      "incident reports, vendor updates). Only extract facts with an explicit number attached.",
    prompt: `Document:\n\n${truncated}`,
    schema: FACT_EXTRACTION_SCHEMA,
    effort: "medium",
  });
  return result.facts;
}
