import {
  NoReasoningProvider,
  type EmbeddingProvider,
  type ReasoningProvider,
} from "@decisionloop/core/ports/providers";
import { BedrockEmbeddingProvider, BedrockReasoningProviderV2 } from "./bedrock";
import { LexicalEmbeddingProvider } from "./lexicalEmbeddings";
import { OpenAICompatibleEmbeddingProvider, OpenAICompatibleReasoningProvider } from "./openaiCompatible";

export { LexicalEmbeddingProvider } from "./lexicalEmbeddings";
export { BedrockEmbeddingProvider, BedrockReasoningProviderV2 } from "./bedrock";
export { OpenAICompatibleEmbeddingProvider, OpenAICompatibleReasoningProvider } from "./openaiCompatible";

type Env = Record<string, string | undefined>;

/**
 * Provider selection (spec §17):
 *
 *   DECISIONLOOP_REASONING_PROVIDER = bedrock | openai | none
 *   DECISIONLOOP_EMBEDDING_PROVIDER = bedrock | openai | lexical
 *
 * Defaults: Bedrock when AWS_REGION is set (the 1.x behaviour), else no
 * model (reasoning) and the offline lexical embedding. An OpenAI-compatible
 * endpoint is used only when selected explicitly — an OPENAI_API_KEY that
 * happens to be in the environment for other tools must never cause
 * workspace data to be sent to a third party. With no reasoning model,
 * deterministic evaluation still runs; semantic evaluations are recorded
 * as UNAVAILABLE and change nothing.
 */
export function selectReasoningProvider(env: Env = process.env): ReasoningProvider {
  const choice = env.DECISIONLOOP_REASONING_PROVIDER?.trim() || defaultChoice(env, "none");
  switch (choice) {
    case "bedrock":
      return new BedrockReasoningProviderV2(env.BEDROCK_REASONING_MODEL_ID);
    case "openai":
      return new OpenAICompatibleReasoningProvider({
        baseUrl: env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
        apiKey: env.OPENAI_API_KEY,
        model: requireEnv(env, "OPENAI_REASONING_MODEL"),
      });
    case "none":
      return new NoReasoningProvider();
    default:
      throw new Error(`Unknown DECISIONLOOP_REASONING_PROVIDER "${choice}" (bedrock | openai | none).`);
  }
}

export function selectEmbeddingProvider(env: Env = process.env): EmbeddingProvider {
  const choice = env.DECISIONLOOP_EMBEDDING_PROVIDER?.trim() || defaultChoice(env, "lexical");
  switch (choice) {
    case "bedrock":
      return new BedrockEmbeddingProvider(env.BEDROCK_EMBEDDING_MODEL_ID);
    case "openai":
      return new OpenAICompatibleEmbeddingProvider({
        baseUrl: env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
      });
    case "lexical":
      return new LexicalEmbeddingProvider();
    default:
      throw new Error(`Unknown DECISIONLOOP_EMBEDDING_PROVIDER "${choice}" (bedrock | openai | lexical).`);
  }
}

function defaultChoice(env: Env, fallback: string): string {
  if (env.AWS_REGION?.trim()) return "bedrock";
  return fallback;
}

function requireEnv(env: Env, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} must be set for the selected provider.`);
  return v;
}
