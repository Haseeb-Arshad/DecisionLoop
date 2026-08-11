import { describe, expect, it } from "vitest";
import {
  IllegalStatusTransitionError,
  assertTransition,
  canTransition,
} from "@/lib/domain/decisionStatus";
import type { DecisionStatus } from "@/lib/types";

/**
 * §9 status lifecycle. The property that matters most is that SUPERSEDED
 * and ARCHIVED are terminal — §3 Principle 3 requires that historical truth
 * is never destroyed because circumstances changed, so a superseded
 * decision stays superseded and the replacement is a separate row.
 */

const ALL: DecisionStatus[] = [
  "DRAFT",
  "ACTIVE",
  "AT_RISK",
  "REOPENED",
  "SUPERSEDED",
  "ARCHIVED",
];

describe("decision status transitions", () => {
  it("allows the normal commit path DRAFT → ACTIVE", () => {
    expect(canTransition("DRAFT", "ACTIVE")).toBe(true);
  });

  it("allows the core product flow ACTIVE → AT_RISK → REOPENED", () => {
    expect(canTransition("ACTIVE", "AT_RISK")).toBe(true);
    expect(canTransition("AT_RISK", "REOPENED")).toBe(true);
  });

  it("allows AT_RISK → ACTIVE, so dismissing a conflict can restore a decision", () => {
    expect(canTransition("AT_RISK", "ACTIVE")).toBe(true);
  });

  it("treats SUPERSEDED as terminal", () => {
    for (const to of ALL) {
      if (to === "SUPERSEDED") continue;
      expect(canTransition("SUPERSEDED", to)).toBe(false);
    }
  });

  it("treats ARCHIVED as terminal", () => {
    for (const to of ALL) {
      if (to === "ARCHIVED") continue;
      expect(canTransition("ARCHIVED", to)).toBe(false);
    }
  });

  it("refuses to move a draft straight to at-risk", () => {
    expect(canTransition("DRAFT", "AT_RISK")).toBe(false);
  });

  it("assertTransition is a no-op for a same-status write", () => {
    expect(() => assertTransition("ACTIVE", "ACTIVE")).not.toThrow();
  });

  it("assertTransition throws a typed error naming both states", () => {
    try {
      assertTransition("SUPERSEDED", "ACTIVE");
      throw new Error("expected assertTransition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalStatusTransitionError);
      const typed = err as IllegalStatusTransitionError;
      expect(typed.from).toBe("SUPERSEDED");
      expect(typed.to).toBe("ACTIVE");
      expect(typed.message).toContain("terminal state");
    }
  });
});
