import { describe, expect, it } from "vitest";
import { tryDeterministicConflictCheck } from "@/lib/ai/bedrock";
import { normalizeAssumption } from "@/lib/repo/decisions";
import type { Assumption, ExtractedFact } from "@/lib/types";

/**
 * §21: "price < 25000 vs price = 42000 should not require an LLM to decide
 * whether it conflicts." This is the deterministic shortcut that makes that
 * true — lib/ai/bedrock.ts#analyzeConflict only falls through to a model
 * call when this returns null.
 */

const baseAssumption: Assumption = {
  id: "assumption-1",
  decisionId: "decision-1",
  statement: "SignalForge pricing stays under $25,000/year",
  normalizedStatement: "annual_price < 25000 usd/year",
  assumptionType: "QUANTITATIVE",
  metric: "annual_price",
  operator: "<",
  value: 25000,
  unit: "USD/year",
  validityStatus: "VALID",
  importance: 0.9,
  confidence: 0.8,
  authorityScore: 0.8,
  validFrom: new Date().toISOString(),
  validUntil: null,
  invalidatedByEvidenceId: null,
  challengedAt: null,
  invalidatedAt: null,
  createdAt: new Date().toISOString(),
};

function fact(overrides: Partial<ExtractedFact> = {}): ExtractedFact {
  return {
    subject: "SignalForge",
    metric: "annual_price",
    operator: "=",
    value: 42000,
    unit: "USD/year",
    statement: "SignalForge annual price is now $42,000",
    sourceQuote: "**$42,000 per year**",
    ...overrides,
  };
}

describe("tryDeterministicConflictCheck", () => {
  it("reports CONTRADICTS for the canonical $42K vs <$25K case, with no model call", () => {
    const result = tryDeterministicConflictCheck({
      fact: fact(),
      assumption: baseAssumption,
      decisionTitle: "Analytics vendor",
      otherOptionNames: ["MetricLake"],
    });
    expect(result).not.toBeNull();
    expect(result!.relation).toBe("CONTRADICTS");
    expect(result!.conflictType).toBe("VALUE_CHANGED");
    expect(result!.confidence).toBe(1);
    expect(result!.explanation).toContain("42000");
  });

  it("carries the old and new values through for the at-risk card", () => {
    const result = tryDeterministicConflictCheck({
      fact: fact(),
      assumption: baseAssumption,
      decisionTitle: "Analytics vendor",
      otherOptionNames: [],
    });
    expect(result!.oldValue).toContain("25000");
    expect(result!.newValue).toContain("42000");
    expect(result!.sourceQuote).toBe("**$42,000 per year**");
  });

  it("suggests the sole alternative when exactly one was rejected", () => {
    const result = tryDeterministicConflictCheck({
      fact: fact(),
      assumption: baseAssumption,
      decisionTitle: "Analytics vendor",
      otherOptionNames: ["MetricLake"],
    });
    expect(result!.suggestedOptionName).toBe("MetricLake");
  });

  it("does not guess an alternative when several were rejected", () => {
    const result = tryDeterministicConflictCheck({
      fact: fact(),
      assumption: baseAssumption,
      decisionTitle: "Analytics vendor",
      otherOptionNames: ["MetricLake", "DataForge"],
    });
    expect(result!.suggestedOptionName).toBe("");
  });

  it("reports SUPPORTS when the new value still satisfies the constraint", () => {
    const result = tryDeterministicConflictCheck({
      fact: fact({ value: 20000 }),
      assumption: baseAssumption,
      decisionTitle: "Analytics vendor",
      otherOptionNames: ["MetricLake"],
    });
    expect(result!.relation).toBe("SUPPORTS");
  });

  it("falls through to the model for a different metric", () => {
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

  it("falls through on a mismatched unit rather than comparing dollars to euros", () => {
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

  it("tolerates cosmetic differences in metric naming", () => {
    const result = tryDeterministicConflictCheck({
      fact: fact({ metric: "Annual Price" }),
      assumption: baseAssumption,
      decisionTitle: "Analytics vendor",
      otherOptionNames: [],
    });
    expect(result).not.toBeNull();
    expect(result!.relation).toBe("CONTRADICTS");
  });
});

describe("normalizeAssumption", () => {
  it("produces a stable machine-comparable form", () => {
    expect(
      normalizeAssumption({
        metric: "Annual Price",
        operator: "<",
        value: 25000,
        unit: "USD/year",
      }),
    ).toBe("annual_price < 25000 usd/year");
  });

  it("returns null when the assumption has no structured constraint", () => {
    expect(normalizeAssumption({ metric: "annual_price", operator: null, value: null })).toBeNull();
  });

  it("omits the unit when none is given", () => {
    expect(normalizeAssumption({ metric: "uptime", operator: ">=", value: 99.9 })).toBe(
      "uptime >= 99.9",
    );
  });
});
