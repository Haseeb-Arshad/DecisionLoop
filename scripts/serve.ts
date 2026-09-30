async function main() {
  Object.assign(process.env, { NODE_ENV: "production" });
  await import("@decisionloop/runtime/env");
  if (!process.env.DATABASE_URL?.trim())
    throw new Error(
      "Production start requires DATABASE_URL. For local embedded mode, use decisionloop serve --web.",
    );
  if ((process.env.SESSION_SECRET?.trim().length ?? 0) < 32)
    throw new Error(
      "Production start requires a SESSION_SECRET of at least 32 characters.",
    );
  const { createRuntime } = await import("@decisionloop/runtime");
  const { startServer } = await import("@decisionloop/runtime/server");
  const { githubServerExtensions } = await import("@decisionloop/github");
  const runtime = await createRuntime({ allowEmbedded: false, migrate: false });
  const extensions = githubServerExtensions(runtime.loop, process.env);
  const server = await startServer(runtime, {
    host: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 3000),
    worker: process.env.DECISIONLOOP_DISABLE_WORKER !== "true",
    extraRoutes: extensions.routes,
    workerHandlers: extensions.handlers,
    web: { dir: process.cwd(), dev: false },
  });
  console.log(
    `DecisionLoop ready on ${server.url}; worker ${server.worker ? "on" : "off"}.`,
  );
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await server.close();
    await runtime.stop();
    process.exit(0);
  }
  process.on("SIGTERM", () => void close());
  process.on("SIGINT", () => void close());
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
