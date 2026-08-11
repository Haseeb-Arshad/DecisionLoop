import { describe, expect, it } from "vitest";
import {
  conflictJudgmentValidator,
  decisionExtractionValidator,
  factsValidator,
  memoryAnswerValidator,
} from "@/lib/ai/schemas";

/**
 * §19: "If the LLM produces invalid output: retry safely. Do not let
 * malformed AI responses crash the application."
 *
 * The JSON schema constrains generation; these validators are the runtime
 * check that the constraint actually held. Where a field can degrade
 * gracefully (a confidence slightly out of range, an unknown enum member)
 * they clamp rather than reject, so one odd number doesn't fail an entire
 * document ingestion. Where the field is load-bearing (no options at all,
 * an empty answer) they reject, so the caller retries.
 */

describe("decisionExtractionValidator", () => {
  const valid = {
    title: "Analytics vendor",
    problemStatement: "Choose a vendor",
    reasoning: "Cheaper",
    confidence: 0.8,
    options: [
      { name: "SignalForge", description: "", isChosen: true, rejectionReason: "" },
    ],
    assumptions: [],
    risks: [],
    evidenceReferences: [],
  };

  it("accepts a well-formed extraction", () => {
    expect(decisionExtractionValidator.parse(valid).title).toBe("Analytics vendor");
  });

  it("clamps an out-of-range confidence instead of failing", () => {
    expect(decisionExtractionValidator.parse({ ...valid, confidence: 4.5 }).confidence).toBe(1);
    expect(decisionExtractionValidator.parse({ ...valid, confidence: -2 }).confidence).toBe(0);
  });

  it("falls back to a default assumption type for an unknown enum value", () => {
    const parsed = decisionExtractionValidator.parse({
      ...valid,
      assumptions: [
        {
          statement: "price stays low",
          assumptionType: "INVENTED_TYPE",
          metric: "annual_price",
          operator: "<",
          value: 25000,
          unit: "USD/year",
          importance: 0.9,
          confidence: 0.8,
        },
      ],
    });
    expect(parsed.assumptions[0]!.assumptionType).toBe("QUANTITATIVE");
  });

  it("coerces a numeric value delivered as a string", () => {
    const parsed = decisionExtractionValidator.parse({
      ...valid,
      assumptions: [
        {
          statement: "price stays low",
          assumptionType: "QUANTITATIVE",
          metric: "annual_price",
          operator: "<",
          value: "25000",
          unit: "USD/year",
          importance: 0.9,
          confidence: 0.8,
        },
      ],
    });
    expect(parsed.assumptions[0]!.value).toBe(25000);
  });

  it("rejects an extraction with no options — that is not a decision", () => {
    expect(() => decisionExtractionValidator.parse({ ...valid, options: [] })).toThrow();
  });

  it("rejects a missing title", () => {
    expect(() => decisionExtractionValidator.parse({ ...valid, title: "" })).toThrow();
  });

  it("defaults absent optional collections rather than throwing", () => {
    const parsed = decisionExtractionValidator.parse({
      title: "T",
      confidence: 0.5,
      options: [{ name: "A", description: "", isChosen: true, rejectionReason: "" }],
    });
    expect(parsed.assumptions).toEqual([]);
    expect(parsed.risks).toEqual([]);
  });
});

describe("factsValidator", () => {
  it("accepts a well-formed fact list", () => {
    const parsed = factsValidator.parse({
      facts: [
        {
          subject: "SignalForge",
          metric: "annual_price",
          operator: "=",
          value: 42000,
          unit: "USD/year",
          statement: "Now $42,000/year",
          sourceQuote: "$42,000 per year",
        },
      ],
    });
    expect(parsed.facts).toHaveLength(1);
  });

  it("defaults to an empty list when the model returns no facts field", () => {
    expect(factsValidator.parse({}).facts).toEqual([]);
  });

  it("falls back to '=' for an unrecognised operator", () => {
    const parsed = factsValidator.parse({
      facts: [
        {
          subject: "X",
          metric: "m",
          operator: "≈",
          value: 1,
          unit: "u",
          statement: "s",
          sourceQuote: "q",
        },
      ],
    });
    expect(parsed.facts[0]!.operator).toBe("=");
  });
});

describe("conflictJudgmentValidator", () => {
  it("defaults an unrecognised relation to UNCERTAIN rather than guessing CONTRADICTS", () => {
    const parsed = conflictJudgmentValidator.parse({
      relation: "MAYBE",
      conflictType: "VALUE_CHANGED",
      confidence: 0.9,
      explanation: "",
      oldValue: "",
      newValue: "",
      sourceQuote: "",
      suggestedOptionName: "",
    });
    // Defaulting to UNCERTAIN is the safe direction: it records nothing,
    // where defaulting to CONTRADICTS would flag a sound decision.
    expect(parsed.relation).toBe("UNCERTAIN");
  });

  it("clamps confidence into the unit interval", () => {
    const parsed = conflictJudgmentValidator.parse({
      relation: "CONTRADICTS",
      conflictType: "VALUE_CHANGED",
      confidence: 12,
      explanation: "",
      oldValue: "",
      newValue: "",
      sourceQuote: "",
      suggestedOptionName: "",
    });
    expect(parsed.confidence).toBe(1);
  });
});

describe("memoryAnswerValidator", () => {
  it("defaults groundedInMemory to false when the model omits or mangles it", () => {
    const parsed = memoryAnswerValidator.parse({
      answer: "I couldn't find a committed decision about that.",
      groundedInMemory: "sort of",
      citedReferences: [],
      followUpSuggestion: "",
    });
    // False is the safe default: an ungrounded answer rendered as grounded
    // would be exactly the hallucinated organizational history §41 forbids.
    expect(parsed.groundedInMemory).toBe(false);
  });

  it("rejects an empty answer", () => {
    expect(() =>
      memoryAnswerValidator.parse({
        answer: "",
        groundedInMemory: true,
        citedReferences: [],
        followUpSuggestion: "",
      }),
    ).toThrow();
  });
});
