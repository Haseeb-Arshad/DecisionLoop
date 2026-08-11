import { describe, expect, it } from "vitest";
import {
  AUTHORITY_TOLERANCE,
  MIN_CONFIDENCE_TO_INVALIDATE,
  MIN_CONFIDENCE_TO_RECORD,
  authorityForSourceType,
  classifyConflictSeverity,
} from "@/lib/domain/decisionStatus";

/**
 * decision.md §20: "Never allow a low-authority random document to silently
 * invalidate an important decision. Authority and confidence matter."
 * These tests pin that rule down.
 */

describe("authorityForSourceType", () => {
  it("ranks a signed contract above a vendor's own document", () => {
    expect(authorityForSourceType("CONTRACT")).toBeGreaterThan(
      authorityForSourceType("VENDOR_OFFICIAL"),
    );
  });

  it("ranks an unverified upload lowest", () => {
    const unverified = authorityForSourceType("UNVERIFIED");
    for (const source of ["CONTRACT", "VENDOR_OFFICIAL", "INTERNAL_ANALYSIS", "NEWS", "OTHER"]) {
      expect(authorityForSourceType(source)).toBeGreaterThan(unverified);
    }
  });

  it("falls back to the OTHER score for an unrecognised source type", () => {
    expect(authorityForSourceType("SOMETHING_NEW")).toBe(authorityForSourceType("OTHER"));
  });
});

describe("classifyConflictSeverity", () => {
  const strongEvidence = { evidenceAuthority: 0.85, assumptionAuthority: 0.7 };
  const weakEvidence = { evidenceAuthority: 0.3, assumptionAuthority: 0.9 };

  it("invalidates when confidence is high and the source is authoritative", () => {
    const result = classifyConflictSeverity({
      relation: "CONTRADICTS",
      confidence: 0.95,
      ...strongEvidence,
    });
    expect(result.record).toBe(true);
    expect(result.nextValidity).toBe("INVALIDATED");
    expect(result.flagDecision).toBe(true);
  });

  it("only challenges — never invalidates — when the source is much weaker than the assumption", () => {
    const result = classifyConflictSeverity({
      relation: "CONTRADICTS",
      confidence: 0.99,
      ...weakEvidence,
    });
    expect(result.record).toBe(true);
    expect(result.nextValidity).toBe("CHALLENGED");
    // Still flagged for a human — weak evidence is not ignored, just not
    // allowed to rewrite history on its own.
    expect(result.flagDecision).toBe(true);
    expect(result.reason).toMatch(/materially weaker/i);
  });

  it("challenges rather than invalidates when confidence is middling", () => {
    const result = classifyConflictSeverity({
      relation: "CONTRADICTS",
      confidence: 0.6,
      ...strongEvidence,
    });
    expect(result.nextValidity).toBe("CHALLENGED");
  });

  it("records nothing below the minimum confidence threshold", () => {
    const result = classifyConflictSeverity({
      relation: "CONTRADICTS",
      confidence: MIN_CONFIDENCE_TO_RECORD - 0.01,
      ...strongEvidence,
    });
    expect(result.record).toBe(false);
    expect(result.nextValidity).toBeNull();
    expect(result.flagDecision).toBe(false);
  });

  it("records nothing for supporting or irrelevant evidence", () => {
    for (const relation of ["SUPPORTS", "IRRELEVANT", "UNCERTAIN"] as const) {
      const result = classifyConflictSeverity({
        relation,
        confidence: 0.99,
        ...strongEvidence,
      });
      expect(result.record).toBe(false);
    }
  });

  it("treats UPDATES as worth recording — a changed value can still break a constraint", () => {
    const result = classifyConflictSeverity({
      relation: "UPDATES",
      confidence: 0.9,
      ...strongEvidence,
    });
    expect(result.record).toBe(true);
  });

  it("allows invalidation when evidence is within tolerance of the assumption's authority", () => {
    const result = classifyConflictSeverity({
      relation: "CONTRADICTS",
      confidence: MIN_CONFIDENCE_TO_INVALIDATE,
      evidenceAuthority: 0.8 - AUTHORITY_TOLERANCE,
      assumptionAuthority: 0.8,
    });
    expect(result.nextValidity).toBe("INVALIDATED");
  });

  it("drops to CHALLENGED once evidence falls outside that tolerance", () => {
    const result = classifyConflictSeverity({
      relation: "CONTRADICTS",
      confidence: MIN_CONFIDENCE_TO_INVALIDATE,
      evidenceAuthority: 0.8 - AUTHORITY_TOLERANCE - 0.01,
      assumptionAuthority: 0.8,
    });
    expect(result.nextValidity).toBe("CHALLENGED");
  });
});
