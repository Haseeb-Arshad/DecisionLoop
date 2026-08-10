import crypto from "node:crypto";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

/**
 * Embedding provider abstraction. Default: Amazon Titan Text Embeddings V2
 * on Bedrock (`BEDROCK_EMBEDDING_MODEL_ID`, default
 * `amazon.titan-embed-text-v2:0`), requested at 512 dimensions — matching
 * the memory_chunks.embedding VECTOR(512) column. Titan V2 retains ~99%
 * retrieval accuracy at 512 dims vs its 1024 default
 * (docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-titan-text-embeddings-v2.html).
 *
 * When AWS_REGION is unset, falls back to a deterministic local hash
 * embedding so `npm run dev`, `npm test`, and the seed script work without
 * live AWS credentials. The fallback has NO semantic meaning — it's a
 * stable pseudo-random unit vector derived from the text's SHA-256 hash, so
 * identical text always embeds identically (useful for tests) but
 * similarity between *different* text is meaningless. Demo/production
 * correctness for retrieval and conflict detection requires real Bedrock
 * access with Titan Embeddings model access enabled in the console.
 */
export const EMBEDDING_DIMENSIONS = 512;
const BEDROCK_EMBEDDING_MODEL_ID =
  process.env.BEDROCK_EMBEDDING_MODEL_ID ?? "amazon.titan-embed-text-v2:0";

export interface EmbeddingProvider {
  readonly modelName: string;
  embed(texts: string[]): Promise<number[][]>;
}

let bedrockClient: BedrockRuntimeClient | null = null;

function getBedrockClient(): BedrockRuntimeClient {
  if (bedrockClient) return bedrockClient;
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error("AWS_REGION is not set. See .env.example.");
  }
  bedrockClient = new BedrockRuntimeClient({ region });
  return bedrockClient;
}

interface TitanEmbeddingResponse {
  embedding: number[];
  embeddingsByType?: Record<string, number[]>;
}

class BedrockEmbeddingProvider implements EmbeddingProvider {
  readonly modelName = BEDROCK_EMBEDDING_MODEL_ID;

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    // Titan Text Embeddings V2 takes one inputText per InvokeModel call —
    // there's no batch endpoint. Run concurrently; document-scale batches
    // (a handful to ~12 chunks, see lib/engine/documentIngestion.ts) are
    // well within Bedrock's per-account TPS limits for this.
    return Promise.all(texts.map((text) => this.embedOne(text)));
  }

  private async embedOne(text: string): Promise<number[]> {
    const command = new InvokeModelCommand({
      modelId: BEDROCK_EMBEDDING_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        inputText: text,
        dimensions: EMBEDDING_DIMENSIONS,
        normalize: true,
      }),
    });
    const response = await getBedrockClient().send(command);
    const parsed = JSON.parse(
      new TextDecoder().decode(response.body),
    ) as TitanEmbeddingResponse;
    return parsed.embedding;
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
  provider = process.env.AWS_REGION
    ? new BedrockEmbeddingProvider()
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
