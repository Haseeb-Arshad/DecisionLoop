import http from "node:http";
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
  opts: { port?: number; host?: string; worker?: boolean; extraRoutes?: ExtraRoute[]; workerHandlers?: Parameters<Runtime["loop"]["createWorker"]>[1] } = {},
): Promise<ServerHandle> {
  const handler = createApiHandler({
    loop: runtime.loop,
    authenticate: async (req) => {
      const auth = req.headers.get("authorization");
      const key = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
      return authenticateApiKey(runtime.loop.store, key);
    },
    extraRoutes: opts.extraRoutes,
  });

  const server = http.createServer(async (req, res) => {
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
    worker = runtime.loop.createWorker({ workerId: `serve-${process.pid}`, pollIntervalMs: 500 }, opts.workerHandlers);
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
