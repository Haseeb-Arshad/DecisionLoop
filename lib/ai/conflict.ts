import { callClaudeStructured } from "@/lib/ai/anthropic";
import type { Assumption, ExtractedFact } from "@/lib/types";

const CONFLICT_JUDGMENT_SCHEMA = {
  type: "object",
  properties: {
    invalidated: {
      type: "boolean",
      description: "True only if the fact directly and concretely contradicts the assumption's stated constraint.",
    },
    explanation: {
      type: "string",
      description:
        "One or two sentences a person would read on the decision page: state the old assumption, " +
        "the new fact, and why they conflict (or don't). Be specific with numbers.",
    },
    suggestedOptionName: {
      type: "string",
      description:
        "If invalidated and one of the previously-rejected options listed below now looks worth " +
        "reconsidering given this new fact, its exact name. Empty string otherwise.",
    },
  },
  required: ["invalidated", "explanation", "suggestedOptionName"],
  additionalProperties: false,
} as const;

export interface ConflictJudgment {
  invalidated: boolean;
  explanation: string;
  suggestedOptionName: string;
}

/**
 * The judgment call at the center of automatic assumption invalidation:
 * given one new fact and one previously-stored assumption (found via vector
 * retrieval, not told to be related), does the fact make the assumption
 * false? This is deliberately a separate, narrow call per (fact, assumption)
 * pair rather than one big "check everything" prompt — it keeps the
 * reasoning auditable per-pair in the Memory Inspector trace, and keeps each
 * call cheap enough to run against every retrieved candidate.
 */
export async function judgeAssumptionConflict(input: {
  fact: ExtractedFact;
  assumption: Assumption;
  decisionTitle: string;
  otherOptionNames: string[];
}): Promise<ConflictJudgment> {
  const { fact, assumption, decisionTitle, otherOptionNames } = input;

  const prompt = [
    `Decision: "${decisionTitle}"`,
    "",
    "Stored assumption this decision depends on:",
    `  "${assumption.statement}"`,
    assumption.metric && assumption.operator && assumption.value !== null
      ? `  Structured constraint: ${assumption.metric} ${assumption.operator} ${assumption.value} ${assumption.unit ?? ""}`.trim()
      : "  (no structured constraint captured)",
    "",
    "New fact from a document just uploaded (the document did not say which decision it relates to):",
    `  "${fact.statement}"`,
    `  Structured: ${fact.subject}.${fact.metric} ${fact.operator} ${fact.value} ${fact.unit}`,
    "",
    otherOptionNames.length > 0
      ? `Options originally rejected for this decision: ${otherOptionNames.join(", ")}`
      : "No other options were recorded for this decision.",
    "",
    "Does the new fact invalidate the stored assumption? Only say yes if the numbers/claims " +
      "actually conflict — a fact about a different subject or a compatible number is not a conflict.",
  ].join("\n");

  return callClaudeStructured<ConflictJudgment>({
    system:
      "You judge whether a new factual claim invalidates a previously-recorded decision " +
      "assumption. Be conservative: only flag a real, numeric contradiction, not a vague thematic " +
      "overlap. Ground every judgment in the specific numbers given.",
    prompt,
    schema: CONFLICT_JUDGMENT_SCHEMA,
    effort: "high",
  });
}
