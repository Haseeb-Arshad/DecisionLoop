import { createApiHandler } from "@decisionloop/api";
import { createDecisionLoop, type DecisionLoop } from "@decisionloop/core/services/index";
import type { Actor } from "@decisionloop/core/types/records";
import { githubServerExtensions } from "@decisionloop/github";
import { selectEmbeddingProvider, selectReasoningProvider } from "@decisionloop/providers";
import { authenticateApiKey } from "@decisionloop/runtime/apiKeys";
import { SqlDecisionStore } from "@decisionloop/storage-sql/store";
import { sql } from "@/db/client";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { childLogger } from "@/lib/logger";

/**
 * The web app's DecisionLoop instance: the same services the CLI, MCP
 * server and worker use, over the app's shared connection pool. The web app
 * is the control plane; business rules live in @decisionloop/core.
 *
 * Note: the web process does not run the job worker. Run `npm run
 * decisionloop -- worker` (or `serve`) alongside it so queued evidence is
 * evaluated.
 */

declare global {
  var __decisionloop_loop__: DecisionLoop | undefined;
  var __decisionloop_handler__: ((req: Request) => Promise<Response>) | undefined;
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

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/**
 * Machine clients authenticate with an API key. A signed-in person using
 * the control plane authenticates with their session cookie and acts as a
 * human with full workspace access.
 */
export async function authenticateRequest(req: Request): Promise<Actor | null> {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return authenticateApiKey(getDecisionLoop().store, auth.slice(7).trim());
  }
  const token = cookieValue(req.headers.get("cookie"), SESSION_COOKIE_NAME);
  const claims = token ? await verifySessionToken(token) : null;
  if (!claims) return null;
  return {
    tenantId: claims.tenantId,
    type: "user",
    userId: claims.userId,
    label: `user:${claims.userId.slice(0, 8)}`,
    scopes: ["admin"],
    sessionId: `sess_${claims.sessionId.slice(0, 12)}`,
  };
}

export function getApiHandler(): (req: Request) => Promise<Response> {
  if (!globalThis.__decisionloop_handler__) {
    const loop = getDecisionLoop();
    const github = githubServerExtensions(loop, process.env);
    globalThis.__decisionloop_handler__ = createApiHandler({
      loop,
      authenticate: authenticateRequest,
      extraRoutes: github.routes,
    });
  }
  return globalThis.__decisionloop_handler__;
}
