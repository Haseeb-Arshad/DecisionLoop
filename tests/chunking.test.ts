import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/engine/documentIngestion";

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

  it("caps the number of chunks at 12", () => {
    const paragraphs = Array.from(
      { length: 20 },
      (_, i) => `Paragraph number ${i} is long enough to pass the minimum chunk length filter easily.`,
    );
    const chunks = chunkText(paragraphs.join("\n\n"));
    expect(chunks.length).toBeLessThanOrEqual(12);
  });

  it("falls back to fixed-size windows when there are no paragraph breaks", () => {
    const text = "x".repeat(3000);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1200);
    }
  });

  it("returns nothing for text with no substantial content", () => {
    expect(chunkText("hi\n\nbye")).toHaveLength(0);
  });
});
