import crypto from "node:crypto";

/**
 * Embedding provider abstraction. Default: Voyage AI (`voyage-3-lite`,
 * 512 dimensions — matches the memory_chunks.embedding VECTOR(512) column).
 * Voyage is Anthropic's recommended embeddings partner; Claude itself does
 * not serve an embeddings endpoint.
 *
 * When VOYAGE_API_KEY is unset, falls back to a deterministic local hash
 * embedding so `npm run dev`, `npm test`, and the seed script work without a
 * second external credential. The fallback has NO semantic meaning — it's a
 * stable pseudo-random unit vector derived from the text's SHA-256 hash, so
 * identical text always embeds identically (useful for tests) but similarity
 * between *different* text is meaningless. Demo/production correctness for
 * retrieval and conflict detection requires a real VOYAGE_API_KEY.
 */
export const EMBEDDING_DIMENSIONS = 512;
const VOYAGE_MODEL = "voyage-3-lite";

export interface EmbeddingProvider {
  readonly modelName: string;
  embed(texts: string[]): Promise<number[][]>;
}

class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly modelName = VOYAGE_MODEL;
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: texts,
        model: VOYAGE_MODEL,
        input_type: "document",
        output_dimension: EMBEDDING_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Voyage embeddings request failed (${response.status}): ${body.slice(0, 500)}`,
      );
    }

    const json = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };
    return json.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}

class DeterministicHashEmbeddingProvider implements EmbeddingProvider {
  readonly modelName = "local-hash-fallback-v1";

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => hashEmbed(text));
  }
}

function hashEmbed(text: string): number[] {
  // Expand a SHA-256 digest into EMBEDDING_DIMENSIONS pseudo-random floats
  // via a simple counter-mode stretch, then L2-normalize so cosine
  // similarity behaves the way it would for a real embedding model.
  const vector = new Array<number>(EMBEDDING_DIMENSIONS);
  let counter = 0;
  let offset = 0;
  let buffer = Buffer.alloc(0);
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    if (offset + 4 > buffer.length) {
      buffer = crypto
        .createHash("sha256")
        .update(text)
        .update(String(counter))
        .digest();
      counter += 1;
      offset = 0;
    }
    const int = buffer.readUInt32BE(offset);
    offset += 4;
    // Map to [-1, 1]
    vector[i] = int / 0xffffffff / 2 - 1 + int / 0xffffffff;
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

let provider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (provider) return provider;
  const apiKey = process.env.VOYAGE_API_KEY;
  provider = apiKey
    ? new VoyageEmbeddingProvider(apiKey)
    : new DeterministicHashEmbeddingProvider();
  return provider;
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
