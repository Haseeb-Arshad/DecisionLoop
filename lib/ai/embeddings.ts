import type { EmbeddingProvider } from "@decisionloop/core/ports/providers";
import { selectEmbeddingProvider } from "@decisionloop/providers";

/**
 * Embedding access for the web app. Provider selection lives in
 * packages/providers (Bedrock Titan V2, OpenAI-compatible, or the offline
 * lexical embedding), so every surface embeds with the same model.
 *
 * The 1.x offline fallback hashed the whole text with SHA-256, which made
 * similarity between different texts meaningless. The offline default is
 * now a lexical feature-hashing embedding: similarity tracks shared
 * vocabulary. It is not semantic; production retrieval should use Bedrock
 * or an OpenAI-compatible embedding model.
 */
export const EMBEDDING_DIMENSIONS = 512;

export type { EmbeddingProvider };

let provider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (!provider) provider = selectEmbeddingProvider();
  return provider;
}

/** True when the configured provider is a real embedding model. */
export function isSemanticEmbeddingProvider(p: EmbeddingProvider = getEmbeddingProvider()): boolean {
  return !p.modelName.startsWith("local-");
}

export async function embedText(text: string): Promise<{ embedding: number[]; model: string }> {
  const p = getEmbeddingProvider();
  const [embedding] = await p.embed([text]);
  if (!embedding) throw new Error("Embedding provider returned no result.");
  return { embedding, model: p.modelName };
}

export async function embedTexts(
  texts: string[],
): Promise<{ embeddings: number[][]; model: string }> {
  const p = getEmbeddingProvider();
  const embeddings = await p.embed(texts);
  return { embeddings, model: p.modelName };
}
