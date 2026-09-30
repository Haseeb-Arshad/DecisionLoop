import http from "node:http";
import { randomUUID } from "node:crypto";
import { workerHeartbeat } from "./heartbeat";
import { takeRequestLimit } from "./requestLimits";
import { Readable } from "node:stream";
import { createApiHandler, type ExtraRoute } from "@decisionloop/api";
import type { Worker } from "@decisionloop/core/services/worker";
import { authenticateApiKey } from "./apiKeys";
import type { Runtime } from "./index";

/**
 * Standalone DecisionLoop server: HTTP API, remote MCP endpoint and the job
 * worker in one process. With the embedded database this process is the
 * only one holding a database connection, which is what keeps local mode
 * correct (docs/v2 §5).
 *
 * Binds to 127.0.0.1 unless told otherwise: exposing it on a network is a
 * deliberate act.
 */
export interface ServerHandle {
  url: string;
  port: number;
  worker: Worker | null;
  close(): Promise<void>;
}

export async function startServer(
  runtime: Runtime,
  opts: {
    port?: number;
    host?: string;
    worker?: boolean;
    extraRoutes?: ExtraRoute[];
    workerHandlers?: Parameters<Runtime["loop"]["createWorker"]>[1];
    localWorkspaceId?: string;
    /**
     * Also serve the Next.js control plane from this process. It shares this
     * process's single database connection (db/client.ts reads the global
     * pool), which is what makes the web UI safe on the embedded database.
     */
    web?: { dir: string; dev?: boolean };
  } = {},
): Promise<ServerHandle> {
  const handler = createApiHandler({
    takeRateLimit: actor => takeRequestLimit(runtime.sql, `api:${actor.tenantId}:${actor.apiKeyId ?? actor.userId ?? actor.label}`, 600),
    loop: runtime.loop,
    authenticate: async (req) => {
      const auth = req.headers.get("authorization");
      const key = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
      return authenticateApiKey(runtime.loop.store, key);
    },
    extraRoutes: opts.extraRoutes,
  });

  type NodeHandler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;
  let nextHandle: NodeHandler | null = null;
  if (opts.web) {
    globalThis.__decisionloop_local_workspace__ = opts.localWorkspaceId;
    (globalThis as { __decisionloop_sql__?: unknown }).__decisionloop_sql__ = runtime.sql;
    process.env.DATABASE_URL ??= runtime.databaseUrl;
    // Next resolves its build directories against the working directory, so
    // a custom server must run from the app root. Every path this process
    // needs (database, config) was resolved before this point.
    process.chdir(opts.web.dir);
    const { default: next } = await import("next");
    const app = next({ dev: opts.web.dev ?? false, dir: opts.web.dir });
    await app.prepare();
    nextHandle = app.getRequestHandler() as unknown as NodeHandler;
  }
  const server = http.createServer(async (req, res) => {
    // With the web app mounted, every route goes through Next: its /api/v1
    // and /mcp handlers are the same @decisionloop/api handler, but also
    // accept the signed-in person's session cookie.
    if (nextHandle) {
      await nextHandle(req, res);
      return;
    }
    try {
      const host = req.headers.host ?? "127.0.0.1";
      const url = new URL(req.url ?? "/", `http://${host}`);
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const request = new Request(url, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
        // Required by Node's fetch implementation for streamed request bodies.
        ...(hasBody ? { duplex: "half" } : {}),
      } as RequestInit);
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      if (response.body) {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
      }
      res.end();
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  });

  const host = opts.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 4318, host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : (opts.port ?? 4318);

  let worker: Worker | null = null;
  const abort = new AbortController();
  let workerDone: Promise<void> = Promise.resolve();
  if (opts.worker !== false) {
    const workerId = `serve-${randomUUID()}`;
    worker = runtime.loop.createWorker({ workerId, pollIntervalMs: 500, periodic: [workerHeartbeat(runtime.sql, workerId)] }, opts.workerHandlers);
    workerDone = worker.start(abort.signal);
  }

  return {
    url: `http://${host}:${port}`,
    port,
    worker,
    async close() {
      worker?.stop();
      abort.abort();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await workerDone.catch(() => undefined);
    },
  };
}
