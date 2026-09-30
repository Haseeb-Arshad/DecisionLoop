import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createRuntime } from "@decisionloop/runtime";

/** Verifies the actual production entry point against a disposable SQL server.
 * Build first. This never opens the configured production database or calls a model.
 */
async function main() {
  const scratch = path.resolve(".scratch");
  fs.mkdirSync(scratch, { recursive: true });
  const dir = fs.mkdtempSync(path.join(scratch, "production-smoke-"));
  const db = await createRuntime({
    allowEmbedded: true,
    dataDir: path.join(dir, "pgdata"),
    env: {
      DATABASE_URL: "",
      DECISIONLOOP_REASONING_PROVIDER: "none",
      DECISIONLOOP_EMBEDDING_PROVIDER: "lexical",
    },
  });
  await db.sql.end({ timeout: 5 });
  const secret = randomBytes(32).toString("hex");
  let child: ChildProcess | null = null;
  let base = "";
  let cookie = "";
  const receipt: Record<string, unknown> = {
    database: "disposable embedded PostgreSQL over TCP",
    reasoning: "none",
    embeddings: "lexical",
  };
  async function start(allowSignup: boolean) {
    base = await new Promise<string>((resolve, reject) => {
      let output = "";
      child = spawn(
        process.execPath,
        ["node_modules/tsx/dist/cli.mjs", "scripts/serve.ts"],
        {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          env: {
            ...process.env,
            NODE_ENV: "production",
            DATABASE_URL: db.databaseUrl,
            DATABASE_POOL_MAX: "1",
            SESSION_SECRET: secret,
            PORT: "0",
            HOST: "127.0.0.1",
            DECISIONLOOP_ALLOW_SIGNUP: String(allowSignup),
            DECISIONLOOP_DISABLE_WORKER: "false",
            DECISIONLOOP_REASONING_PROVIDER: "none",
            DECISIONLOOP_EMBEDDING_PROVIDER: "lexical",
            GITHUB_WEBHOOK_SECRET: "",
            GITHUB_APP_ID: "",
            GITHUB_APP_PRIVATE_KEY: "",
            GITHUB_TOKEN: "",
          },
        },
      );
      const timer = setTimeout(
        () =>
          reject(
            new Error("Production server did not start within 45 seconds."),
          ),
        45000,
      );
      child.stdout!.on("data", (chunk) => {
        output += String(chunk);
        const match = output.match(/DecisionLoop ready on (http:\/\/[^;]+);/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]!);
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (!output.includes("DecisionLoop ready"))
          reject(
            new Error(`Production process exited before readiness (${code}).`),
          );
      });
      child.once("error", reject);
      child.stderr!.resume();
    });
  }
  async function stop() {
    const processToStop = child;
    if (!processToStop) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        processToStop.kill("SIGKILL");
      }, 10000);
      processToStop.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      processToStop.kill("SIGTERM");
    });
    child = null;
  }
  async function request(route: string, body?: unknown, expected = 200) {
    const response = await fetch(base + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (response.status !== expected)
      throw new Error(
        `${route} returned ${response.status}, expected ${expected}: ${result.error ?? "unexpected response"}`,
      );
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    return result;
  }
  async function waitFor<T>(
    read: () => Promise<T>,
    ready: (value: T) => boolean,
  ) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const value = await read();
      if (ready(value)) return value;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Background processing did not reach the expected state.");
  }
  try {
    await start(true);
    receipt.productionHealth = (await request("/api/health")).status;
    const account = {
      workspaceName: "Production smoke",
      name: "Test reviewer",
      email: "production-smoke@example.test",
      password: "SmokeTest-2026-Only",
    };
    const signup = await request("/api/auth/signup", account);
    receipt.authentication = Boolean(signup.user?.id);
    await request(
      "/api/decisions/extract",
      { notes: "Use Redis for the session cache." },
      503,
    );
    receipt.unconfiguredAssistance = "503 with actionable guidance";
    await request("/api/documents/upload-url", {
      filename: "source.md", mimeType: "text/markdown", sizeBytes: 32,
    }, 503);
    receipt.unconfiguredDocumentExtraction = "503 before upload";
    const decision = await request("/api/v1/decisions?mode=commit", {
      title: "Keep cache latency below 20 ms",
      chosenOption: { name: "Redis" },
      rationale: "The session lookup budget is 20 ms.",
      resources: ["src/auth/**", "npm:redis"],
      assumptions: [
        {
          statement: "Latency stays below 20 ms",
          subject: "infrastructure:redis",
          predicate: "latency",
          valueType: "NUMBER",
          operator: "<",
          expected: 20,
          unit: "ms",
          authority: 1,
        },
      ],
    });
    receipt.createdDecision = decision.id;
    for (const value of [30, 40]) {
      const event = await request("/api/v1/evidence", {
        statement: `Measured latency ${value} ms`,
        facts: [
          {
            subject: "infrastructure:redis",
            predicate: "latency",
            valueType: "NUMBER",
            value,
            unit: "ms",
            statement: `Latency is ${value} ms`,
          },
        ],
      });
      await waitFor(
        () => request(`/api/v1/events/${event.eventId}`),
        (result) => result.status === "PROCESSED",
      );
    }
    const history = await request(`/api/v1/decisions/${decision.id}`);
    if (history.conflicts.length !== 2 || history.decision.status !== "AT_RISK")
      throw new Error("Two conflicts did not keep the decision at risk.");
    await request(`/api/conflicts/${history.conflicts[0].id}/resolve`, {
      resolution: "dismiss",
      note: "The first observation was stale.",
    });
    const remaining = await request(`/api/v1/decisions/${decision.id}`);
    if (
      remaining.decision.status !== "AT_RISK" ||
      remaining.conflicts.filter(
        (c: { resolution: string | null }) => !c.resolution,
      ).length !== 1
    )
      throw new Error(
        "Browser dismissal incorrectly cleared the remaining conflict.",
      );
    receipt.multipleConflictReview = "passed";
    receipt.workerHeartbeat = (
      await request("/api/workspace")
    ).capabilities.workerHealthy;
    if (!receipt.workerHeartbeat)
      throw new Error("The production worker did not publish a fresh heartbeat.");
    const context = await request("/api/v1/context", {
      intent: "Refactor authentication",
      resources: ["npm:redis"],
    });
    if (!context.decisions.some((d: { id: string }) => d.id === decision.id))
      throw new Error("Resource context did not retrieve the decision.");
    receipt.contextRetrieval = "passed";
    await stop();
    cookie = "";
    await start(false);
    await request(
      "/api/auth/signup",
      { ...account, email: "closed@example.test" },
      403,
    );
    await request("/api/auth/login", {
      email: account.email,
      password: account.password,
    });
    const persisted = await request(`/api/v1/decisions/${decision.id}`);
    if (
      persisted.decision.status !== "AT_RISK" ||
      persisted.conflicts.length !== 2
    )
      throw new Error("Decision history did not survive restart.");
    receipt.restartPersistence = "passed";
    receipt.closedHostedSignup = "passed";
    receipt.completedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(dir, "receipt.json"),
      JSON.stringify(receipt, null, 2),
    );
    console.log(JSON.stringify(receipt, null, 2));
    console.log(`Saved ${path.join(dir, "receipt.json")}`);
  } finally {
    await stop();
    await db.stop();
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
