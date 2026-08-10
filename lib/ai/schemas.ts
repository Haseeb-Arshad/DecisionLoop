// JSON schemas for every structured Bedrock call (lib/ai/bedrock.ts). Kept in
// one file since they're pure data and get reused if the reasoning provider
// is ever swapped again.

export const extractDecisionSchema = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description:
        "Short (< 12 words) title for the decision, e.g. 'Workflow tool: SignalForge vs MetricLake'.",
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
          statement: {
            type: "string",
            description: "Human-readable form, e.g. 'SignalForge pricing stays under $25,000/year'.",
          },
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

export const extractFactsSchema = {
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
          statement: {
            type: "string",
            description: "The fact in plain language, quoting or closely paraphrasing the source.",
          },
        },
        required: ["subject", "metric", "operator", "value", "unit", "statement"],
        additionalProperties: false,
      },
    },
  },
  required: ["facts"],
  additionalProperties: false,
} as const;

export const conflictJudgmentSchema = {
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
