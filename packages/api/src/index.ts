import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ZodError } from "zod";
import { DecisionLoopError, ApprovalRequiredError } from "@decisionloop/core/errors";
import { bindOperations, type DecisionLoopOperations } from "@decisionloop/core/operations";
import type { DecisionLoop } from "@decisionloop/core/services/index";
import type { Actor } from "@decisionloop/core/types/records";
import { buildMcpServer } from "@decisionloop/mcp";

/**
 * DecisionLoop's versioned HTTP API (`/api/v1/*`) and remote MCP endpoint
 * (`/mcp`), as one Fetch-standard handler: `(Request) => Promise<Response>`.
 * The same function runs inside Next.js route handlers and inside the
 * standalone `decisionloop serve` process — no business logic here, only
 * authentication, parsing and error mapping over `DecisionLoopOperations`.
 */

export type Authenticate = (req: Request) => Promise<Actor | null>;
export type ExtraRoute = (req: Request, url: URL) => Promise<Response | null>;

export interface ApiOptions {
  loop: DecisionLoop;
  authenticate: Authenticate;
  /** Mount point of the v1 API; default `/api/v1`. */
  basePath?: string;
  mcpPath?: string;
  maxBodyBytes?: number;
  rateLimitPerMinute?: number;
  /** Routes that authenticate themselves (e.g. signed webhooks). Tried first. */
  extraRoutes?: ExtraRoute[];
}

const STATUS: Record<DecisionLoopError["code"], number> = {
  not_found: 404,
  forbidden: 403,
  invalid: 400,
  conflict: 409,
  approval_required: 202,
  unavailable: 503,
};

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApprovalRequiredError) {
    return jsonResponse({ error: err.message, code: err.code, approvalId: err.approvalId }, 202);
  }
  if (err instanceof DecisionLoopError) return jsonResponse({ error: err.message, code: err.code }, STATUS[err.code]);
  if (err instanceof ZodError) return jsonResponse({ error: "Invalid request.", code: "invalid", details: err.flatten() }, 400);
  if (err instanceof HttpError) return jsonResponse({ error: err.message, code: err.code }, err.status);
  // Illegal lifecycle transitions are client errors, not server faults.
  if (err instanceof Error && err.name === "IllegalStatusTransitionError") return jsonResponse({ error: err.message, code: "conflict" }, 409);
  const message = err instanceof Error ? err.message : String(err);
  return jsonResponse({ error: message.slice(0, 500), code: "internal" }, 500);
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Fixed-window limiter per credential. In-process: good for one node; hosted deployments add a shared limiter. */
class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(private readonly perMinute: number) {}
  take(key: string): boolean {
    const now = Date.now();
    const w = this.windows.get(key);
    if (!w || now - w.start >= 60_000) {
      this.windows.set(key, { start: now, count: 1 });
      if (this.windows.size > 10_000) this.windows.clear();
      return true;
    }
    w.count += 1;
    return w.count <= this.perMinute;
  }
}

async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "too_large", `Request body exceeds ${maxBytes} bytes.`);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON.");
  }
}

type Handler = (ops: DecisionLoopOperations, params: string[], body: unknown, url: URL) => Promise<unknown>;

const routes: Array<[string, RegExp, Handler]> = [
  ["GET", /^\/me$/, (ops) => ops.whoami()],
  ["POST", /^\/context$/, (ops, _p, body) => ops.getContext(body as never)],
  ["POST", /^\/decisions\/search$/, (ops, _p, body) => ops.searchDecisions(body as never)],
  ["POST", /^\/decisions$/, (ops, _p, body, url) =>
    url.searchParams.get("mode") === "commit" ? ops.createDecision(body as never) : ops.proposeDecision(body as never)],
  ["GET", /^\/decisions\/([^/]+)$/, (ops, [id]) => ops.getDecision(decodeURIComponent(id!))],
  ["GET", /^\/decisions\/([^/]+)\/explain$/, (ops, [id]) => ops.explainDecision(decodeURIComponent(id!))],
  ["POST", /^\/decisions\/([^/]+)\/commit$/, (ops, [id], body) => ops.commitDecision(id!, (body as { note?: string })?.note)],
  ["POST", /^\/decisions\/([^/]+)\/supersede$/, (ops, [id], body) => {
    const b = body as { supersededBy?: string; note?: string };
    if (!b?.supersededBy) throw new HttpError(400, "invalid", "supersededBy is required.");
    return ops.supersedeDecision(id!, b.supersededBy, b.note);
  }],
  ["POST", /^\/decisions\/([^/]+)\/outcomes$/, (ops, [id], body) => ops.recordOutcome({ ...(body as object), decisionId: id! } as never)],
  ["POST", /^\/decisions\/([^/]+)\/assumptions$/, (ops, [id], body) => ops.proposeAssumption({ ...(body as object), decisionId: id! } as never)],
  ["GET", /^\/decisions\/([^/]+)\/blast-radius$/, (ops, [id], _b, url) =>
    ops.blastRadius({ decisionId: id!, assumptionId: url.searchParams.get("assumptionId"), maxDepth: Number(url.searchParams.get("maxDepth") ?? 4) })],
  ["GET", /^\/at-risk$/, (ops, _p, _b, url) => ops.listAtRisk(Number(url.searchParams.get("limit") ?? 20))],
  ["POST", /^\/constraints$/, (ops, _p, body) => ops.getConstraints(body as never)],
  ["GET", /^\/conflicts$/, (ops, _p, _b, url) =>
    ops.getConflicts({ decisionId: url.searchParams.get("decisionId"), includeResolved: url.searchParams.get("includeResolved") === "true" })],
  ["POST", /^\/conflicts\/([^/]+)\/accept$/, (ops, [id], body) => ops.acceptConflict(id!, (body as { note?: string })?.note)],
  ["POST", /^\/conflicts\/([^/]+)\/dismiss$/, (ops, [id], body) => ops.dismissConflict(id!, (body as { note?: string })?.note)],
  ["POST", /^\/evidence$/, (ops, _p, body) => ops.addEvidence(body as never)],
  ["GET", /^\/events$/, (ops, _p, _b, url) => ops.listEvents(Number(url.searchParams.get("limit") ?? 50))],
  ["GET", /^\/events\/([^/]+)$/, (ops, [id]) => ops.getEvent(id!)],
  ["GET", /^\/events\/([^/]+)\/detail$/, (ops, [id]) => ops.getEventDetail(id!)],
  ["GET", /^\/approvals$/, (ops, _p, _b, url) => ops.listApprovals((url.searchParams.get("status") as never) ?? undefined)],
  ["POST", /^\/approvals\/([^/]+)$/, (ops, [id], body) => ops.resolveApproval(id!, body as never)],
  ["POST", /^\/sessions$/, (ops, _p, body) => ops.attachSession(body as never)],
  ["GET", /^\/sessions$/, (ops) => ops.listSessions()],
  ["GET", /^\/sessions\/([^/]+)$/, (ops, [id]) => ops.inspectSession(id!)],
  ["POST", /^\/sessions\/([^/]+)\/end$/, (ops, [id], body) => ops.endSession({ agentSessionId: id!, outcome: (body as { outcome?: string })?.outcome ?? null })],
];

export function createApiHandler(opts: ApiOptions): (req: Request) => Promise<Response> {
  const base = opts.basePath ?? "/api/v1";
  const mcpPath = opts.mcpPath ?? "/mcp";
  const maxBody = opts.maxBodyBytes ?? 1_000_000;
  const limiter = new RateLimiter(opts.rateLimitPerMinute ?? 600);

  async function actorFor(req: Request): Promise<Actor> {
    const actor = await opts.authenticate(req);
    if (!actor) throw new HttpError(401, "unauthenticated", "Provide a DecisionLoop API key: Authorization: Bearer dl_…");
    if (!limiter.take(actor.apiKeyId ?? actor.userId ?? actor.label)) {
      throw new HttpError(429, "rate_limited", "Too many requests; slow down.");
    }
    return actor;
  }

  /** Agents identify their session via headers so every call lands in the Agent Run Inspector. */
  async function opsFor(req: Request, actor: Actor): Promise<DecisionLoopOperations> {
    const ops = bindOperations(opts.loop, actor);
    const agent = req.headers.get("x-decisionloop-agent");
    const session = req.headers.get("x-decisionloop-session");
    if (agent && session) {
      await ops.attachSession({
        agent: agent.slice(0, 60),
        externalSessionId: session.slice(0, 200),
        repository: req.headers.get("x-decisionloop-repository")?.slice(0, 200) ?? null,
      });
    }
    return ops;
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    try {
      for (const extra of opts.extraRoutes ?? []) {
        const res = await extra(req, url);
        if (res) return res;
      }

      if (url.pathname === `${base}/health`) {
        await opts.loop.store.listJobs({ status: "DEAD", limit: 1 });
        return jsonResponse({ ok: true });
      }

      if (url.pathname === mcpPath) {
        const actor = await actorFor(req);
        const ops = await opsFor(req, actor);
        // Stateless streamable HTTP: a fresh server per request, scoped to
        // this credential's permissions.
        const server = buildMcpServer(ops, { type: actor.type, scopes: actor.scopes });
        const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        await server.connect(transport);
        return await transport.handleRequest(req);
      }

      if (!url.pathname.startsWith(base)) return jsonResponse({ error: "Not found.", code: "not_found" }, 404);
      const sub = url.pathname.slice(base.length) || "/";
      for (const [method, pattern, handler] of routes) {
        if (method !== req.method) continue;
        const m = pattern.exec(sub);
        if (!m) continue;
        const actor = await actorFor(req);
        const ops = await opsFor(req, actor);
        const body = await readJson(req, maxBody);
        const result = await handler(ops, m.slice(1), body, url);
        return jsonResponse(result ?? { ok: true });
      }
      return jsonResponse({ error: `No route for ${req.method} ${url.pathname}.`, code: "not_found" }, 404);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
