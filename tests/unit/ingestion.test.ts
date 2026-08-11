import { describe, expect, it } from "vitest";
import { chunkText, chunkTextWithPages, hashContent } from "@/lib/engine/documentIngestion";
import { EMBEDDING_DIMENSIONS, embedText } from "@/lib/ai/embeddings";
import { slugify } from "@/lib/repo/tenants";

describe("chunkText", () => {
  it("splits on blank-line paragraph breaks", () => {
    const text =
      "Paragraph one is long enough to count as a real chunk of text for this test.\n\n" +
      "Paragraph two is also long enough to count as a real chunk of text for this test.";
    expect(chunkText(text)).toHaveLength(2);
  });

  it("drops fragments shorter than the minimum chunk length", () => {
    const text =
      "Too short.\n\n" +
      "This paragraph is definitely long enough to survive the minimum length filter applied to chunks.";
    expect(chunkText(text)).toHaveLength(1);
  });

  it("bounds every chunk even when the document has no paragraph breaks", () => {
    // Regression: a single huge paragraph previously bypassed the windowing
    // fallback entirely and became one oversized chunk.
    const chunks = chunkText("x".repeat(3000));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1200);
    }
  });

  it("windows an over-long paragraph that sits alongside normal ones", () => {
    const text = `${"a".repeat(3000)}\n\nA short but sufficiently long trailing paragraph here.`;
    for (const chunk of chunkText(text)) {
      expect(chunk.length).toBeLessThanOrEqual(1200);
    }
  });

  it("returns nothing for text with no substantial content", () => {
    expect(chunkText("hi\n\nbye")).toHaveLength(0);
  });
});

describe("chunkTextWithPages", () => {
  it("attributes chunks to 1-based pages when form feeds are present", () => {
    const page1 = "First page content that is comfortably long enough to be indexed as a chunk.";
    const page2 = "Second page content that is also comfortably long enough to be a chunk.";
    const chunks = chunkTextWithPages(`${page1}\f${page2}`);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.pageNumber).toBe(1);
    expect(chunks[1]!.pageNumber).toBe(2);
  });

  it("leaves page attribution null for text with no page boundaries", () => {
    const chunks = chunkTextWithPages(
      "Plain text with no page breaks at all, but long enough to be a chunk.",
    );
    expect(chunks[0]!.pageNumber).toBeNull();
  });

  it("assigns a monotonic chunk index across pages", () => {
    const long = "Content long enough to survive the minimum chunk length filter here.";
    const chunks = chunkTextWithPages(`${long}\f${long} second\f${long} third`);
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
  });
});

describe("hashContent", () => {
  it("is stable for identical content, so a re-upload is recognised", () => {
    expect(hashContent("same text")).toBe(hashContent("same text"));
  });

  it("differs for different content", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });
});

// The deterministic fallback provider runs when AWS_REGION is unset, which
// is the case in the test environment. It has no semantic meaning, but it
// must be well-formed so retrieval code behaves identically with or without
// live Bedrock access.
describe("embedding fallback provider", () => {
  it("matches the dimensionality of the memory_chunks.embedding column", async () => {
    const { embedding } = await embedText("SignalForge pricing stays under $25,000/year");
    expect(embedding).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("is deterministic for identical input", async () => {
    const a = await embedText("hello world");
    const b = await embedText("hello world");
    expect(a.embedding).toEqual(b.embedding);
  });

  it("produces different vectors for different input", async () => {
    const a = await embedText("SignalForge annual pricing");
    const b = await embedText("MetricLake enterprise tier");
    expect(a.embedding).not.toEqual(b.embedding);
  });

  it("returns a unit-length vector so cosine similarity behaves", async () => {
    const { embedding } = await embedText("unit norm check");
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Northstar Commerce")).toBe("northstar-commerce");
  });

  it("strips non-alphanumeric characters", () => {
    expect(slugify("Foo & Bar, Inc.!")).toBe("foo-bar-inc");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("--Acme--")).toBe("acme");
  });

  it("falls back to 'workspace' when nothing alphanumeric remains", () => {
    expect(slugify("   !!!   ")).toBe("workspace");
  });
});
