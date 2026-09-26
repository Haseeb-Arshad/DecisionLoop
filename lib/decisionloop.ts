import { createApiHandler } from "@decisionloop/api";
import type { Actor } from "@decisionloop/core/types/records";
import { githubServerExtensions } from "@decisionloop/github";
import { authenticateApiKey } from "@decisionloop/runtime/apiKeys";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { getDecisionLoop } from "@/lib/decisionloopInstance";

/**
 * HTTP wiring for the control plane: authentication (API key or session
 * cookie) and the shared v1/MCP/webhook handler. The web process does not
 * run the job worker; run `npm run decisionloop -- worker` (or `serve`)
 * alongside it so queued evidence is evaluated.
 */

declare global {
  var __decisionloop_handler__: ((req: Request) => Promise<Response>) | undefined;
}

export { getDecisionLoop };

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
