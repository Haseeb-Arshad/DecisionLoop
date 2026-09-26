import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { z, type ZodType } from "zod";
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
 * Amazon Bedrock transport: Claude via InvokeModel in the Anthropic message
 * format with `output_config.format` structured outputs, and Titan Text
 * Embeddings V2 at 512 dimensions. Shared by the 1.x provider
 * (lib/ai/bedrock.ts) and the 2.0 ReasoningProvider below.
 */

export const DEFAULT_BEDROCK_REASONING_MODEL = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
export const DEFAULT_BEDROCK_EMBEDDING_MODEL = "amazon.titan-embed-text-v2:0";

const clients = new Map<string, BedrockRuntimeClient>();

export function getBedrockClient(region = process.env.AWS_REGION): BedrockRuntimeClient {
  if (!region) throw new Error("AWS_REGION is not set. See .env.example.");
  let client = clients.get(region);
  if (!client) {
    client = new BedrockRuntimeClient({ region });
    clients.set(region, client);
  }
  return client;
}

export class BedrockRefusalError extends Error {
  constructor(public readonly stopDetails: unknown) {
    super("Bedrock declined this request");
    this.name = "BedrockRefusalError";
  }
}

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    public readonly rawText: string,
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

export interface StructuredCallOptions<T> {
  modelId: string;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  validator: ZodType<T>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxAttempts?: number;
  onInvalidOutput?: (info: { attempt: number; maxAttempts: number; error: unknown; preview: string }) => void;
  client?: BedrockRuntimeClient;
}

interface AnthropicOnBedrockResponse {
  stop_reason?: string;
  stop_details?: unknown;
  content: Array<{ type: string; text?: string }>;
}

export async function invokeBedrockStructured<T>(opts: StructuredCallOptions<T>): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const body = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: opts.maxTokens ?? 8192,
      system:
        attempt === 1
          ? opts.system
          : `${opts.system}\n\nYour previous response did not conform to the required JSON schema. ` +
            `Return only valid JSON matching the schema exactly.`,
      output_config: {
        effort: opts.effort ?? "medium",
        format: { type: "json_schema", schema: opts.schema },
      },
      messages: [{ role: "user", content: opts.prompt }],
    };

    const response = await (opts.client ?? getBedrockClient()).send(
      new InvokeModelCommand({
        modelId: opts.modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(body),
      }),
    );
    const raw = JSON.parse(new TextDecoder().decode(response.body)) as AnthropicOnBedrockResponse;

    // A refusal is a policy decision, not malformed output; retrying the
    // identical prompt would only be refused again.
    if (raw.stop_reason === "refusal") throw new BedrockRefusalError(raw.stop_details);

    const textBlock = raw.content.find((b) => b.type === "text" && b.text);
    if (!textBlock?.text) {
      lastError = new StructuredOutputError(`Bedrock response had no text block (stop_reason: ${raw.stop_reason}).`, "");
      continue;
    }
    try {
      return opts.validator.parse(JSON.parse(textBlock.text));
    } catch (err) {
      lastError = new StructuredOutputError(
        `Structured output failed validation on attempt ${attempt}/${maxAttempts}: ${err instanceof Error ? err.message : String(err)}`,
        textBlock.text,
      );
      opts.onInvalidOutput?.({ attempt, maxAttempts, error: err, preview: textBlock.text.slice(0, 400) });
    }
  }
  throw lastError ?? new StructuredOutputError("Bedrock structured call failed.", "");
}

export class BedrockEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 512;
  readonly modelName: string;
  constructor(private readonly modelId = process.env.BEDROCK_EMBEDDING_MODEL_ID ?? DEFAULT_BEDROCK_EMBEDDING_MODEL) {
    this.modelName = modelId;
  }

  async embed(texts: string[]): Promise<number[][]> {
    // Titan V2 takes one inputText per call; there is no batch endpoint.
    return Promise.all(
      texts.map(async (text) => {
        const response = await getBedrockClient().send(
          new InvokeModelCommand({
            modelId: this.modelId,
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify({ inputText: text, dimensions: this.dimensions, normalize: true }),
          }),
        );
        return (JSON.parse(new TextDecoder().decode(response.body)) as { embedding: number[] }).embedding;
      }),
    );
  }
}

const judgmentValidator = z.object({
  relation: z.enum(["SUPPORTS", "CONTRADICTS", "UPDATES", "IRRELEVANT", "UNCERTAIN"]),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  quote: z.string(),
});

export class BedrockReasoningProviderV2 implements ReasoningProvider {
  readonly name: string;
  constructor(private readonly modelId = process.env.BEDROCK_REASONING_MODEL_ID ?? DEFAULT_BEDROCK_REASONING_MODEL) {
    this.name = `bedrock:${modelId}`;
  }

  async extractFacts(text: string, hints?: { subjects?: string[]; predicates?: string[] }): Promise<Fact[]> {
    const result = await invokeBedrockStructured({
      modelId: this.modelId,
      system: `${FACT_EXTRACTION_SYSTEM}\n\n${UNTRUSTED_CONTENT_BOUNDARY}`,
      prompt: [
        hints?.predicates?.length ? `Known predicates (prefer these names when they apply): ${hints.predicates.join(", ")}` : "",
        hints?.subjects?.length ? `Known subjects: ${hints.subjects.join(", ")}` : "",
        `Evidence:\n\n${wrapUntrustedContent(text.slice(0, 24_000))}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      schema: factsJsonSchema as unknown as Record<string, unknown>,
      validator: z.object({ facts: z.array(z.unknown()) }),
      effort: "medium",
    });
    return result.facts.flatMap((f) => {
      const parsed = factSchema.safeParse({ ...(f as object), extractor: this.name });
      return parsed.success ? [parsed.data] : [];
    });
  }

  async judge(input: SemanticJudgmentInput): Promise<SemanticJudgment> {
    return invokeBedrockStructured({
      modelId: this.modelId,
      system: JUDGMENT_SYSTEM,
      prompt: renderJudgmentPrompt(input),
      schema: judgmentJsonSchema as unknown as Record<string, unknown>,
      validator: judgmentValidator,
      effort: "high",
    });
  }
}
