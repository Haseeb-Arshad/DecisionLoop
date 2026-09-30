import { z } from "zod";
import { factSchema, type Fact } from "@decisionloop/core/assumptions/facts";
import type {
  EmbeddingProvider,
  ReasoningProvider,
  SemanticJudgment,
  SemanticJudgmentInput,
} from "@decisionloop/core/ports/providers";
import { UNTRUSTED_CONTENT_BOUNDARY, wrapUntrustedContent } from "@decisionloop/core/safety/promptSafety";
import { FACT_EXTRACTION_SYSTEM, JUDGMENT_SYSTEM, factsJsonSchema, judgmentJsonSchema, renderJudgmentPrompt } from "./prompts";

/**
 * OpenAI-compatible HTTP provider (OpenAI, Azure OpenAI with a compatible
 * gateway, vLLM, LM Studio, Ollama's /v1 endpoint …). Uses only
 * `/chat/completions` with `response_format: json_schema` and
 * `/embeddings`, so it works against anything that implements those.
 *
 * Embeddings must come back at 512 dimensions (the storage column width).
 * OpenAI's text-embedding-3 models accept a `dimensions` parameter; models
 * with a fixed different width are rejected at startup rather than
 * producing silently incompatible vectors.
 */

interface OpenAIConfig {
  baseUrl: string;
  apiKey?: string | null;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

async function post<T>(cfg: OpenAIConfig, path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 60_000);
  try {
    const res = await (cfg.fetchImpl ?? fetch)(`${cfg.baseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${path} returned ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly modelName: string;
  readonly dimensions = 512;
  constructor(private readonly cfg: OpenAIConfig) {
    this.modelName = `openai:${cfg.model}@512`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await post<{ data: Array<{ embedding: number[]; index: number }> }>(this.cfg, "/embeddings", {
      model: this.cfg.model,
      input: texts,
      dimensions: this.dimensions,
    });
    const out = res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    for (const v of out) {
      if (v.length !== this.dimensions) {
        throw new Error(
          `Embedding model ${this.cfg.model} returned ${v.length} dimensions; DecisionLoop stores ${this.dimensions}. ` +
            "Use a model that supports the `dimensions` parameter.",
        );
      }
    }
    return out;
  }
}

const judgmentValidator = z.object({
  relation: z.enum(["SUPPORTS", "CONTRADICTS", "UPDATES", "IRRELEVANT", "UNCERTAIN"]),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  quote: z.string(),
});

export class OpenAICompatibleReasoningProvider implements ReasoningProvider {
  readonly name: string;
  constructor(private readonly cfg: OpenAIConfig) {
    this.name = `openai:${cfg.model}`;
  }

  async structured<T>(system: string, user: string, schemaName: string, schema: object, validator: z.ZodType<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await post<{ choices: Array<{ message: { content: string | null; refusal?: string | null } }> }>(
        this.cfg,
        "/chat/completions",
        {
          model: this.cfg.model,
          messages: [
            { role: "system", content: attempt === 1 ? system : `${system}\n\nReturn only JSON matching the schema.` },
            { role: "user", content: user },
          ],
          response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
        },
      );
      const message = res.choices[0]?.message;
      if (message?.refusal) throw new Error(`Model refused: ${message.refusal}`);
      try {
        return validator.parse(JSON.parse(message?.content ?? ""));
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(`Invalid structured output: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async extractFacts(text: string, hints?: { subjects?: string[]; predicates?: string[] }): Promise<Fact[]> {
    const result = await this.structured(
      `${FACT_EXTRACTION_SYSTEM}\n\n${UNTRUSTED_CONTENT_BOUNDARY}`,
      [
        hints?.predicates?.length ? `Known predicates (prefer these names when they apply): ${hints.predicates.join(", ")}` : "",
        hints?.subjects?.length ? `Known subjects: ${hints.subjects.join(", ")}` : "",
        `Evidence:\n\n${wrapUntrustedContent(text.slice(0, 24_000))}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      "facts",
      factsJsonSchema,
      z.object({ facts: z.array(z.unknown()) }),
    );
    return result.facts.flatMap((f) => {
      const parsed = factSchema.safeParse({ ...(f as object), extractor: this.name });
      return parsed.success ? [parsed.data] : [];
    });
  }

  async judge(input: SemanticJudgmentInput): Promise<SemanticJudgment> {
    return this.structured(JUDGMENT_SYSTEM, renderJudgmentPrompt(input), "judgment", judgmentJsonSchema, judgmentValidator);
  }
}
