import { describe, expect, it } from "vitest";
import { tryDeterministicConflictCheck } from "@/lib/ai/bedrock";
import type { Assumption, ExtractedFact } from "@/lib/types";

// decision.md §21: "price < 25000 vs price = 42000 should not require an LLM
// to decide whether it conflicts." This is the deterministic shortcut that
// makes that true — lib/ai/bedrock.ts#analyzeConflict only falls through to
// a model call when this returns null.

const baseAssumption: Assumption = {
  id: "assumption-1",
  decisionId: "decision-1",
  statement: "SignalForge pricing stays under $25,000/year",
  metric: "annual_price",
  operator: "<",
  value: 25000,
  unit: "USD/year",
  status: "VALID",
  createdAt: new Date().toISOString(),
  invalidatedAt: null,
};

function fact(overrides: Partial<ExtractedFact> = {}): ExtractedFact {
  return {
    subject: "SignalForge",
    metric: "annual_price",
    operator: "=",
    value: 42000,
    unit: "USD/year",
    statement: "SignalForge annual price is now $42,000",
    ...overrides,
  };
}

describe("tryDeterministicConflictCheck", () => {
  it("flags a violated constraint as invalidated, without calling a model", () => {
    const result = tryDeterministicConflictCheck({
      fact: fact({ value: 42000 }),
      assumption: baseAssumption,
      decisionTitle: "Analytics vendor",
      otherOptionNames: ["MetricLake"],
    });
    expect(result).not.toBeNull();
    expect(result!.invalidated).toBe(true);
    expect(result!.explanation).toContain("42000");
  });

  it("suggests the sole alternative when there's exactly one", () => {
    const result = tryDeterministicConflictCheck({
      fact: fact({ value: 42000 }),
      assumption: baseAssumption,
      decisionTitle: "Analytics vendor",
      otherOptionNames: ["MetricLake"],
    });
    expect(result!.suggestedOptionName).toBe("MetricLake");
  });

  it("does not guess an alternative when there are several", () => {
    const result = tryDeterministicConflictCheck({
      fact: fact({ value: 42000 }),
      assumption: baseAssumption,
      decisionTitle: "Analytics vendor",
      otherOptionNames: ["MetricLake", "DataForge"],
    });
    expect(result!.suggestedOptionName).toBe("");
  });

  it("reports NOT invalidated when the new value still satisfies the constraint", () => {
    const result = tryDeterministicConflictCheck({
      fact: fact({ value: 20000 }),
      assumption: baseAssumption,
      decisionTitle: "Analytics vendor",
      otherOptionNames: ["MetricLake"],
    });
    expect(result!.invalidated).toBe(false);
  });

  it("falls through (returns null) for a different metric", () => {
    const result = tryDeterministicConflictCheck({
      fact: fact({ metric: "support_response_hours", value: 4, unit: "hours" }),
      assumption: baseAssumption,
      decisionTitle: "Analytics vendor",
      otherOptionNames: [],
    });
    expect(result).toBeNull();
  });

  it("falls through for an inequality-shaped fact rather than a stated value", () => {
    const result = tryDeterministicConflictCheck({
      fact: fact({ operator: "<", value: 30000 }),
      assumption: baseAssumption,
      decisionTitle: "Analytics vendor",
      otherOptionNames: [],
    });
    expect(result).toBeNull();
  });

  it("falls through on a mismatched unit", () => {
    const result = tryDeterministicConflictCheck({
      fact: fact({ unit: "EUR/year" }),
      assumption: baseAssumption,
      decisionTitle: "Analytics vendor",
      otherOptionNames: [],
    });
    expect(result).toBeNull();
  });

  it("falls through when the assumption has no structured constraint", () => {
    const result = tryDeterministicConflictCheck({
      fact: fact(),
      assumption: { ...baseAssumption, metric: null, operator: null, value: null },
      decisionTitle: "Analytics vendor",
      otherOptionNames: [],
    });
    expect(result).toBeNull();
  });
});
