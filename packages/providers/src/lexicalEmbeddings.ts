import crypto from "node:crypto";
import type { EmbeddingProvider } from "@decisionloop/core/ports/providers";

/**
 * Deterministic, offline embedding based on feature hashing of word
 * unigrams and bigrams.
 *
 * It replaces the 1.x fallback, which hashed the *whole text* with SHA-256
 * and therefore gave meaningless similarity between any two different
 * strings (docs/v2 §4.8). Here cosine similarity tracks shared vocabulary:
 * "Redis session store" and "sessions are stored in Redis" are close;
 * "quarterly budget" is not. It is lexical, not semantic — synonyms don't
 * match — but it is honest, reproducible, and good enough to make local
 * development and tests behave like the product.
 */

const STOPWORDS = new Set(
  "a an and are as at be by for from has have in is it its of on or that the this to was were will with we our us you your they them their not no".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9$.]+/g, " ")
    .split(" ")
    .map((t) => t.replace(/^[.$]+|[.]+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/** Tiny suffix stripper so "sessions"/"session" and "stored"/"store" meet. */
function stem(token: string): string {
  if (/^\d/.test(token)) return token;
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (token.length > suffix.length + 3 && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

function bucket(feature: string, dims: number): { index: number; sign: number } {
  const digest = crypto.createHash("sha1").update(feature).digest();
  return { index: digest.readUInt32BE(0) % dims, sign: digest[4]! & 1 ? 1 : -1 };
}

export class LexicalEmbeddingProvider implements EmbeddingProvider {
  readonly modelName = "local-lexical-v1";
  constructor(readonly dimensions = 512) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  embedOne(text: string): number[] {
    const vec = new Array<number>(this.dimensions).fill(0);
    const tokens = tokenize(text);
    const counts = new Map<string, number>();
    for (let i = 0; i < tokens.length; i++) {
      counts.set(tokens[i]!, (counts.get(tokens[i]!) ?? 0) + 1);
      if (i + 1 < tokens.length) {
        const bigram = `${tokens[i]} ${tokens[i + 1]}`;
        counts.set(bigram, (counts.get(bigram) ?? 0) + 0.5);
      }
    }
    for (const [feature, tf] of counts) {
      const { index, sign } = bucket(feature, this.dimensions);
      vec[index]! += sign * (1 + Math.log(tf));
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (norm === 0) {
      // Empty text still needs a valid unit vector for the VECTOR column.
      vec[0] = 1;
      return vec;
    }
    return vec.map((v) => v / norm);
  }
}
