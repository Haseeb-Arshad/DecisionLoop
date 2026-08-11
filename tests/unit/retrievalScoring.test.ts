import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WEIGHTS,
  contextualScore,
  resolveWeights,
  scoreCandidates,
} from "@/lib/engine/retrieval";
import type { MemoryChunkCandidate } from "@/lib/types";

/**
 * §16 warns against blindly implementing arbitrary weights. These tests pin
 * down the behaviour the chosen weights exist to produce, so a future
 * change to them is a deliberate act rather than a silent regression.
 */

function candidate(overrides: Partial<MemoryChunkCandidate> = {}): MemoryChunkCandidate {
  return {
    chunkId: "11111111-1111-4111-8111-111111111111",
    sourceType: "assumption",
    sourceId: "22222222-2222-4222-8222-222222222222",
    decisionId: null,
    contentPreview: "SignalForge pricing stays under $25,000/year",
    similarity: 0.8,
    importance: 0.6,
    authorityScore: 0.7,
    pageNumber: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.RETRIEVAL_WEIGHTS;
});

describe("resolveWeights", () => {
  it("uses the documented defaults when nothing overrides them", () => {
    expect(resolveWeights()).toEqual(DEFAULT_WEIGHTS);
  });

  it("reads overrides from RETRIEVAL_WEIGHTS", () => {
    process.env.RETRIEVAL_WEIGHTS = "semantic:0.7,importance:0.1";
    const weights = resolveWeights();
    expect(weights.semantic).toBe(0.7);
    expect(weights.importance).toBe(0.1);
    // Unspecified keys keep their default rather than becoming zero.
    expect(weights.authority).toBe(DEFAULT_WEIGHTS.authority);
  });

  it("ignores malformed env input rather than throwing", () => {
    process.env.RETRIEVAL_WEIGHTS = "semantic:not-a-number,bogus:0.5,,";
    expect(resolveWeights()).toEqual(DEFAULT_WEIGHTS);
  });

  it("lets an explicit argument win over the environment", () => {
    process.env.RETRIEVAL_WEIGHTS = "semantic:0.7";
    expect(resolveWeights({ semantic: 0.2 }).semantic).toBe(0.2);
  });
});

describe("contextualScore", () => {
  it("boosts memories belonging to the decision currently in focus", () => {
    const inFocus = contextualScore(candidate({ decisionId: "d1" }), {
      focusDecisionId: "d1",
    });
    const unrelated = contextualScore(candidate({ decisionId: "d2" }), {
      focusDecisionId: "d1",
    });
    expect(inFocus).toBeGreaterThan(unrelated);
  });

  it("does not penalise old decisions for being old (§16)", () => {
    const twoYearsAgo = new Date(Date.now() - 730 * 86_400_000).toISOString();
    const old = contextualScore(
      candidate({ sourceType: "decision", createdAt: twoYearsAgo }),
      {},
    );
    const fresh = contextualScore(candidate({ sourceType: "decision" }), {});
    expect(old).toBe(fresh);
  });

  it("does apply freshness to document evidence, where recency is meaningful", () => {
    const oldDoc = contextualScore(
      candidate({
        sourceType: "document",
        createdAt: new Date(Date.now() - 200 * 86_400_000).toISOString(),
      }),
      {},
    );
    const newDoc = contextualScore(candidate({ sourceType: "document" }), {});
    expect(newDoc).toBeGreaterThan(oldDoc);
  });

  it("never exceeds 1", () => {
    const score = contextualScore(
      candidate({ sourceType: "assumption", decisionId: "d1" }),
      { focusDecisionId: "d1" },
    );
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe("scoreCandidates", () => {
  it("ranks an important, authoritative memory above a slightly closer but weak one", () => {
    const scored = scoreCandidates([
      candidate({
        chunkId: "weak",
        similarity: 0.85,
        importance: 0.1,
        authorityScore: 0.2,
      }),
      candidate({
        chunkId: "strong",
        similarity: 0.75,
        importance: 0.95,
        authorityScore: 0.95,
      }),
    ]);
    expect(scored[0]!.chunkId).toBe("strong");
  });

  it("selects only the top K above the minimum score", () => {
    const scored = scoreCandidates(
      [
        candidate({ chunkId: "a", similarity: 0.9 }),
        candidate({ chunkId: "b", similarity: 0.8 }),
        candidate({ chunkId: "c", similarity: 0.05, importance: 0, authorityScore: 0 }),
      ],
      { selectTopK: 2, minFinalScore: 0.3 },
    );
    expect(scored.filter((c) => c.selectedForContext).map((c) => c.chunkId)).toEqual(["a", "b"]);
  });

  it("excludes a top-K candidate that falls below the minimum score", () => {
    const scored = scoreCandidates(
      [candidate({ chunkId: "junk", similarity: 0, importance: 0, authorityScore: 0 })],
      { selectTopK: 5, minFinalScore: 0.3 },
    );
    expect(scored[0]!.selectedForContext).toBe(false);
  });

  it("clamps negative cosine similarity to zero so weights stay meaningful", () => {
    const [scored] = scoreCandidates([candidate({ similarity: -0.4 })]);
    expect(scored!.semanticScore).toBe(0);
    expect(scored!.finalScore).toBeGreaterThanOrEqual(0);
  });

  it("marks a memory as cross-session only when its origin session is known and different", () => {
    const scored = scoreCandidates(
      [
        candidate({ chunkId: "known-other" }),
        candidate({ chunkId: "known-same" }),
        candidate({ chunkId: "unknown-origin" }),
      ],
      {
        signals: {
          sessionId: "session-2",
          originSessionByChunkId: {
            "known-other": "session-1",
            "known-same": "session-2",
          },
        },
      },
    );

    const byId = Object.fromEntries(scored.map((c) => [c.chunkId, c]));
    expect(byId["known-other"]!.crossSession).toBe(true);
    expect(byId["known-same"]!.crossSession).toBe(false);
    // Unknown origin is NOT counted — an unproven cross-session claim would
    // undermine the exact thing the Memory Inspector exists to demonstrate.
    expect(byId["unknown-origin"]!.crossSession).toBe(false);
  });

  it("returns candidates sorted by final score, including the ones that lost", () => {
    const scored = scoreCandidates([
      candidate({ chunkId: "low", similarity: 0.2 }),
      candidate({ chunkId: "high", similarity: 0.95 }),
    ]);
    expect(scored.map((c) => c.chunkId)).toEqual(["high", "low"]);
    expect(scored).toHaveLength(2);
  });
});
