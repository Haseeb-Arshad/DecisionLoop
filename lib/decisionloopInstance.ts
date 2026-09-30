import { createDecisionLoop, type DecisionLoop } from "@decisionloop/core/services/index";
import { selectEmbeddingProvider, selectReasoningProvider } from "@decisionloop/providers";
import { SqlDecisionStore } from "@decisionloop/storage-sql/store";
import { sql } from "@/db/client";
import { childLogger } from "@/lib/logger";

/**
 * The web app's DecisionLoop instance: the same services the CLI, MCP
 * server and worker use, over the app's shared connection pool. Kept free
 * of Next.js imports so engine code (document ingestion) can use it too.
 */

declare global {
  var __decisionloop_loop__: DecisionLoop | undefined;
  var __decisionloop_local_workspace__: string | undefined;
}

const log = childLogger({ module: "decisionloop" });

export function getDecisionLoop(): DecisionLoop {
  globalThis.__decisionloop_loop__ ??= createDecisionLoop({
    store: new SqlDecisionStore(sql),
    embeddings: selectEmbeddingProvider(),
    reasoning: selectReasoningProvider(),
    logger: {
      info: (o, m) => log.info(o, m),
      warn: (o, m) => log.warn(o, m),
      error: (o, m) => log.error(o, m),
    },
  });
  return globalThis.__decisionloop_loop__;
}

/** Test seam: substitute an instance (e.g. with a scripted reasoning provider). */
export function setDecisionLoop(loop: DecisionLoop | null): void {
  globalThis.__decisionloop_loop__ = loop ?? undefined;
}
