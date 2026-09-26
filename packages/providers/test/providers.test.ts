import { describe, expect, it } from "vitest";
import { LexicalEmbeddingProvider, selectEmbeddingProvider, selectReasoningProvider } from "@decisionloop/providers";

const cos = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0);

describe("lexical embedding", () => {
  const p = new LexicalEmbeddingProvider();
  it("similarity tracks shared vocabulary, unlike the 1.x SHA fallback", async () => {
    const [a, b, c] = await p.embed([
      "Use Redis for server-side session storage",
      "sessions are stored in Redis on the server",
      "quarterly marketing budget allocation",
    ]);
    expect(cos(a!, b!)).toBeGreaterThan(0.3);
    expect(cos(a!, c!)).toBeLessThan(0.1);
  });
  it("is deterministic, unit length, 512-d", async () => {
    const [a] = await p.embed(["x y z"]);
    const [b] = await p.embed(["x y z"]);
    expect(a).toEqual(b);
    expect(a!.length).toBe(512);
    expect(Math.abs(cos(a!, a!) - 1)).toBeLessThan(1e-9);
  });
});

describe("provider selection", () => {
  it("never selects a hosted API just because its key is in the environment", () => {
    expect(selectEmbeddingProvider({ OPENAI_API_KEY: "sk-test" }).modelName).toBe("local-lexical-v1");
    expect(selectReasoningProvider({ OPENAI_API_KEY: "sk-test" }).name).toBe("none");
  });
  it("uses an OpenAI-compatible endpoint only when chosen explicitly", () => {
    expect(
      selectEmbeddingProvider({ DECISIONLOOP_EMBEDDING_PROVIDER: "openai", OPENAI_BASE_URL: "http://localhost:11434/v1" }).modelName,
    ).toBe("openai:text-embedding-3-small@512");
  });
  it("keeps the 1.x Bedrock default when AWS_REGION is set", () => {
    expect(selectReasoningProvider({ AWS_REGION: "us-east-1" }).name).toMatch(/^bedrock:/);
  });
});
