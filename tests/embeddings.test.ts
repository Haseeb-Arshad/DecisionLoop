import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS, embedText } from "@/lib/ai/embeddings";

// These exercise the deterministic local fallback provider (no AWS_REGION
// in the test environment) — see lib/ai/embeddings.ts. It has no semantic
// meaning, but it must be well-formed: right dimensionality, deterministic,
// and unit-length so cosine similarity in lib/repo/memoryChunks.ts behaves
// sanely even without a real embedding model configured.
describe("embeddings fallback provider", () => {
  it("returns a vector with the dimensionality memory_chunks.embedding expects", async () => {
    const { embedding } = await embedText("SignalForge pricing stays under $25,000/year");
    expect(embedding).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("is deterministic for identical input text", async () => {
    const a = await embedText("hello world");
    const b = await embedText("hello world");
    expect(a.embedding).toEqual(b.embedding);
  });

  it("produces different vectors for different input text", async () => {
    const a = await embedText("SignalForge annual pricing");
    const b = await embedText("MetricLake enterprise tier");
    expect(a.embedding).not.toEqual(b.embedding);
  });

  it("returns a unit-length vector", async () => {
    const { embedding } = await embedText("unit norm check");
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });
});
