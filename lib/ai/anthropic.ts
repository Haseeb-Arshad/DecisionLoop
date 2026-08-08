import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. See .env.example.");
  }
  client = new Anthropic({ apiKey });
  return client;
}

/** Highest-quality model for the judgment calls this product depends on:
 * extracting assumptions and deciding whether new evidence contradicts one. */
export const CLAUDE_MODEL = "claude-opus-5";

export interface StructuredCallOptions {
  system?: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export class ClaudeRefusalError extends Error {
  constructor(public readonly stopDetails: unknown) {
    super("Claude declined this request");
    this.name = "ClaudeRefusalError";
  }
}

/**
 * One structured-output call: gives Claude a JSON schema via
 * `output_config.format` and returns the parsed, schema-conformant object.
 * Used for every extraction / judgment call in this app (see
 * lib/ai/extraction.ts, lib/ai/conflict.ts) instead of prompt-and-hope JSON
 * parsing.
 */
export async function callClaudeStructured<T>(
  opts: StructuredCallOptions,
): Promise<T> {
  const anthropic = getAnthropicClient();

  // Thinking is on by default for claude-opus-5 and counts against
  // max_tokens, so extraction calls need real headroom, not a tight cap.
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: opts.maxTokens ?? 8192,
    system: opts.system,
    output_config: {
      effort: opts.effort ?? "medium",
      format: {
        type: "json_schema",
        schema: opts.schema,
      },
    },
    messages: [{ role: "user", content: opts.prompt }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (response.stop_reason === "refusal") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    throw new ClaudeRefusalError((response as any).stop_details);
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) {
    throw new Error(
      `Claude response had no text block to parse (stop_reason: ${response.stop_reason}).`,
    );
  }

  try {
    return JSON.parse(textBlock.text) as T;
  } catch (err) {
    throw new Error(
      `Failed to parse Claude's structured output as JSON: ${(err as Error).message}\n` +
        `Raw text: ${textBlock.text.slice(0, 1000)}`,
    );
  }
}
