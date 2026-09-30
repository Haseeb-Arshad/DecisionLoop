import { randomBytes, randomUUID } from "node:crypto";
import { workerHeartbeat } from "@decisionloop/runtime/heartbeat";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DomainRegistry } from "@decisionloop/core/domain-packs/pack";
import { diffPackageJson, engineeringPack, type DependencyChange } from "@decisionloop/core/domain-packs/engineering";
import { inboundEventSchema } from "@decisionloop/core/events/event";
import { parseResource } from "@decisionloop/core/resources/resources";
import type { Scope } from "@decisionloop/core/types/records";
import { buildMcpServer } from "@decisionloop/mcp";
import { DecisionLoop, DecisionLoopApiError } from "@decisionloop/sdk";
import { ensureGitignored, loadConfig, projectDir, writeJson, type ProjectConfig } from "./config";
import { changedFiles, fileAtRevision, repositoryName } from "./git";

const HELP = `decisionloop — persistent reasoning for humans and agents

Usage: decisionloop <command> [options]

Setup
  init [--name <workspace>] [--port 4318]   Create a local workspace, database and API keys
  serve [--port 4318] [--web] [--dev]       Run API + MCP + worker (+ web control plane with --web)
  worker                                    Run only the job worker (needs DATABASE_URL)
  login --url <url> --key <key>             Save credentials for a hosted/remote DecisionLoop
  doctor                                    Check server, credentials, database and MCP
  key create --name <n> [--scopes read,propose] [--type agent|user|integration]
  user create --email <e> [--name <n>]      Web sign-in for this workspace (password from DECISIONLOOP_USER_PASSWORD)
  mcp                                       MCP server over stdio (for Claude Code, Codex, Cursor …)

Everyday
  context [paths…] [--intent <text>]        What should shape work on these files? (default: changed files)
  check [--intent <text>] [--strict]        Check local changes against recorded constraints and decisions
  watch [--interval 5]                      Re-check as you work; prints when governing decisions or findings change
  decisions [--at-risk]                     List decisions
  show <id|ref>                             A decision and its history
  verification add <id|ref> --name <workflow> --repository <owner/repo> [--kind TEST|BENCHMARK|RUNTIME]
  explain <id|ref>                          Why a decision exists
  propose --file <draft.json>               Propose a decision (JSON; see docs/v2)
  evidence add --statement <text> [--fact <json>]… [--resource <r>]…
  approvals [list | approve <id> | reject <id> | evidence <id>] [--note <text>]

Global: --json for machine-readable output.`;

type Out = { json: boolean };

function print(out: Out, value: unknown, human: () => string): void {
  process.stdout.write(`${out.json ? JSON.stringify(value, null, 2) : human()}\n`);
}

function fail(message: string, code = 1): never {
  process.stderr.write(`decisionloop: ${message}\n`);
  process.exit(code);
}

function client(opts: { agent?: boolean } = {}): DecisionLoop {
  const cfg = loadConfig();
  const key = opts.agent ? (cfg.agentKey ?? cfg.apiKey) : cfg.apiKey;
  if (!key) fail("no API key. Run `decisionloop init` (local) or `decisionloop login` (remote), or set DECISIONLOOP_API_KEY.");
  return new DecisionLoop({ baseUrl: cfg.url, apiKey: key });
}

function portOf(url: string): number {
  try {
    return Number(new URL(url).port) || 4318;
  } catch {
    return 4318;
  }
}

async function loadRuntime(opts: { embedded: boolean; migrate?: boolean }) {
  // Imported lazily: most commands only talk HTTP and must stay fast.
  const { createRuntime } = await import("@decisionloop/runtime");
  const cfg = loadConfig();
  return createRuntime({
    allowEmbedded: opts.embedded,
    dataDir: cfg.project?.dataDir ? path.resolve(cfg.project.dataDir) : path.join(projectDir(), "pgdata"),
    migrate: opts.migrate ?? true,
    logger: {
      info: () => {},
      warn: (o, m) => process.stderr.write(`warn: ${m ?? ""} ${JSON.stringify(o)}\n`),
      error: (o, m) => process.stderr.write(`error: ${m ?? ""} ${JSON.stringify(o)}\n`),
    },
  });
}

// ── Commands ────────────────────────────────────────────────────────────────

async function cmdInit(args: string[], out: Out) {
  const { values } = parseArgs({ args, options: { name: { type: "string" }, port: { type: "string" } }, allowPositionals: true });
  const cfg = loadConfig();
  const repository = repositoryName();
  const runtime = await loadRuntime({ embedded: true });
  const { issueApiKey } = await import("@decisionloop/runtime");
  try {
    const existing = cfg.project?.workspaceId ? await runtime.loop.store.getWorkspace(cfg.project.workspaceId) : null;
    const workspace = existing ?? (await runtime.loop.store.createWorkspace(values.name ?? repository ?? path.basename(process.cwd())));
    const human = await issueApiKey(runtime.loop.store, { tenantId: workspace.id, name: "local-admin", scopes: ["admin"], actorType: "user" });
    const agent = await issueApiKey(runtime.loop.store, { tenantId: workspace.id, name: "local-agents", scopes: ["read", "propose"], actorType: "agent" });
    if (repository) {
      await runtime.loop.store.upsertRepositoryBinding({ tenantId: workspace.id, provider: "github", repository }).catch(() => undefined);
    }
    const url = `http://127.0.0.1:${values.port ?? portOf(cfg.url)}`;
    const project: ProjectConfig = { url, workspaceId: workspace.id, repository, ...(runtime.embedded ? { dataDir: path.join(".decisionloop", "pgdata") } : {}) };
    writeJson(path.join(projectDir(), "config.json"), project);
    writeJson(path.join(projectDir(), "credentials.json"), { apiKey: human.key, agentKey: agent.key }, true);
    const ignored = ensureGitignored();
    print(out, { workspaceId: workspace.id, url, embedded: runtime.embedded, repository }, () =>
      [
        `Workspace "${workspace.name}" ready (${runtime.embedded ? "embedded database in .decisionloop/pgdata" : "DATABASE_URL"}).`,
        `API keys saved to .decisionloop/credentials.json${ignored ? " (added .decisionloop/ to .gitignore)" : ""}:`,
        `  local-admin  (you, full access)`,
        `  local-agents (read + propose; agents can never commit)`,
        "",
        "Next:",
        "  decisionloop serve                 # API + MCP + worker",
        "  decisionloop mcp                   # stdio MCP for your agent (see docs/v2/agents.md)",
        "  decisionloop context src/…         # what governs these files?",
      ].join("\n"),
    );
  } finally {
    await runtime.stop();
  }
}

async function cmdServe(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      "no-worker": { type: "boolean" },
      web: { type: "boolean" },
      dev: { type: "boolean" },
    },
  });
  const cfg = loadConfig();
  if (values.web && !process.env.SESSION_SECRET?.trim()) process.env.SESSION_SECRET = localSessionSecret();
  const runtime = await loadRuntime({ embedded: true });
  const { startServer } = await import("@decisionloop/runtime/server");
  const extraRoutes = await githubRoutes(runtime);
  const server = await startServer(runtime, {
    port: Number(values.port ?? portOf(cfg.url)),
    host: values.host ?? "127.0.0.1",
    worker: !values["no-worker"],
    extraRoutes: extraRoutes.routes,
    workerHandlers: extraRoutes.handlers,
    localWorkspaceId: values.host && values.host !== "127.0.0.1" && values.host !== "localhost" ? undefined : cfg.project?.workspaceId,
    web: values.web ? { dir: process.env.DECISIONLOOP_WEB_DIR ?? webDir(), dev: Boolean(values.dev) } : undefined,
  });
  process.stderr.write(
    `DecisionLoop listening on ${server.url}\n${values.web ? `  Web  ${server.url}/dashboard\n` : ""}  API  ${server.url}/api/v1\n  MCP  ${server.url}/mcp\n  database: ${runtime.embedded ? "embedded (.decisionloop/pgdata)" : "DATABASE_URL"}\n  worker: ${values["no-worker"] ? "off" : "on"}\n`,
  );
  const shutdown = async () => {
    await server.close();
    await runtime.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** The Next.js app ships in the DecisionLoop repository root, three levels above this file. */
function webDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/** A per-installation cookie-signing secret for local mode, created once. */
function localSessionSecret(): string {
  const file = path.join(projectDir(), "credentials.json");
  const creds = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>) : {};
  if (!creds.sessionSecret) {
    creds.sessionSecret = randomBytes(32).toString("base64");
    writeJson(file, creds, true);
  }
  return creds.sessionSecret;
}

async function githubRoutes(runtime: Awaited<ReturnType<typeof loadRuntime>>) {
  const gh = await import("@decisionloop/github");
  return gh.githubServerExtensions(runtime.loop, process.env);
}

async function cmdWorker() {
  if (!process.env.DATABASE_URL) fail("`worker` needs DATABASE_URL; `serve` already runs a worker in local mode.");
  const runtime = await loadRuntime({ embedded: false, migrate: false });
  const ext = await githubRoutes(runtime);
  const workerId = `worker-${randomUUID()}`;
  const worker = runtime.loop.createWorker({ workerId, periodic: [workerHeartbeat(runtime.sql, workerId)] }, ext.handlers);
  const abort = new AbortController();
  process.on("SIGINT", () => abort.abort());
  process.on("SIGTERM", () => abort.abort());
  process.stderr.write("DecisionLoop worker running.\n");
  await worker.start(abort.signal);
  await runtime.stop();
}

async function cmdLogin(args: string[]) {
  const { values } = parseArgs({ args, options: { url: { type: "string" }, key: { type: "string" } } });
  if (!values.url || !values.key) fail("login needs --url and --key.");
  const who = await new DecisionLoop({ baseUrl: values.url, apiKey: values.key }).operations.whoami();
  const os = await import("node:os");
  writeJson(path.join(os.homedir(), ".decisionloop", "credentials.json"), { url: values.url, apiKey: values.key }, true);
  process.stdout.write(`Logged in to workspace ${who.workspaceId} as ${who.actor} (${who.type}; ${who.scopes.join(", ")}).\n`);
}

async function cmdDoctor(out: Out) {
  const cfg = loadConfig();
  const checks: Array<{ check: string; ok: boolean; detail: string }> = [];
  const add = (check: string, ok: boolean, detail: string) => checks.push({ check, ok, detail });
  add("config", Boolean(cfg.project || process.env.DECISIONLOOP_URL), cfg.project ? `.decisionloop/config.json → ${cfg.url}` : `using ${cfg.url}`);
  add("credentials", Boolean(cfg.apiKey), cfg.apiKey ? "API key found" : "no API key (run init or login)");
  try {
    const res = await fetch(`${cfg.url}/api/v1/health`);
    add("server", res.ok, `${cfg.url} → HTTP ${res.status}`);
  } catch (err) {
    add("server", false, `${cfg.url} unreachable (${err instanceof Error ? err.message : err}); run \`decisionloop serve\``);
  }
  if (cfg.apiKey) {
    try {
      const who = await client().operations.whoami();
      add("auth", true, `${who.actor} (${who.type}) in ${who.workspaceId}; scopes ${who.scopes.join(",")}`);
    } catch (err) {
      add("auth", false, err instanceof Error ? err.message : String(err));
    }
    try {
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
      const c = new Client({ name: "decisionloop-doctor", version: "1" });
      await c.connect(new StreamableHTTPClientTransport(new URL(`${cfg.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${cfg.agentKey ?? cfg.apiKey}` } } }));
      const tools = await c.listTools();
      await c.close();
      add("mcp", tools.tools.length > 0, `${tools.tools.length} tools at ${cfg.url}/mcp`);
    } catch (err) {
      add("mcp", false, err instanceof Error ? err.message : String(err));
    }
  }
  add("database", true, process.env.DATABASE_URL ? "DATABASE_URL set (CockroachDB/PostgreSQL)" : "embedded (local mode)");
  const reasoning = process.env.DECISIONLOOP_REASONING_PROVIDER ?? (process.env.AWS_REGION ? "bedrock" : "none");
  add("reasoning", true, reasoning === "none" ? "none — deterministic checks only; qualitative assumptions are flagged, not judged" : reasoning);
  print(out, checks, () => checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.check.padEnd(12)} ${c.detail}`).join("\n"));
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

async function cmdKey(args: string[], out: Out) {
  const [sub, ...rest] = args;
  if (sub !== "create") fail("usage: decisionloop key create --name <n> [--scopes read,propose] [--type agent|user|integration]");
  const { values } = parseArgs({ args: rest, options: { name: { type: "string" }, scopes: { type: "string" }, type: { type: "string" }, workspace: { type: "string" } } });
  const cfg = loadConfig();
  const tenantId = values.workspace ?? cfg.project?.workspaceId;
  if (!tenantId || !values.name) fail("key create needs --name and a workspace (run init, or pass --workspace).");
  const scopes = (values.scopes ?? "read,propose").split(",").map((s) => s.trim()) as Scope[];
  const type = (values.type ?? "agent") as "agent" | "user" | "integration";
  const runtime = await loadRuntime({ embedded: true });
  const { issueApiKey } = await import("@decisionloop/runtime");
  try {
    const { key, record } = await issueApiKey(runtime.loop.store, { tenantId, name: values.name, scopes, actorType: type });
    print(out, { id: record.id, key, scopes, type }, () => `Created ${type} key "${values.name}" (${scopes.join(", ")}). Shown once:\n${key}`);
  } finally {
    await runtime.stop();
  }
}

/**
 * Creates a person who can sign in to the web control plane of this local
 * workspace. The password comes from DECISIONLOOP_USER_PASSWORD (never a
 * command-line argument, which would land in shell history).
 */
async function cmdUser(args: string[], out: Out) {
  const [sub, ...rest] = args;
  if (sub !== "create") fail("usage: DECISIONLOOP_USER_PASSWORD=… decisionloop user create --email <e> [--name <n>]");
  const { values } = parseArgs({ args: rest, options: { email: { type: "string" }, name: { type: "string" }, workspace: { type: "string" } } });
  const password = process.env.DECISIONLOOP_USER_PASSWORD;
  const tenantId = values.workspace ?? loadConfig().project?.workspaceId;
  if (!values.email || !tenantId) fail("user create needs --email and a workspace (run init first).");
  if (!password || password.length < 8) fail("set DECISIONLOOP_USER_PASSWORD (8+ characters) in the environment.");
  const bcrypt = await import("bcryptjs");
  const hash = await bcrypt.default.hash(password, 12);
  const runtime = await loadRuntime({ embedded: true });
  try {
    const [row] = await runtime.sql`
      INSERT INTO users (tenant_id, email, password_hash, name, role)
      VALUES (${tenantId}, ${values.email.toLowerCase()}, ${hash}, ${values.name ?? values.email.split("@")[0]!}, 'owner')
      RETURNING id
    `;
    print(out, { id: row!.id, email: values.email }, () => `Created user ${values.email}; sign in at /login.`);
  } finally {
    await runtime.stop();
  }
}

async function cmdMcp() {
  // stdout carries the MCP protocol; anything else goes to stderr.
  const cfg = loadConfig();
  const key = cfg.agentKey ?? cfg.apiKey;
  if (!key) fail("no API key for the MCP server; run `decisionloop init` or set DECISIONLOOP_API_KEY.");
  const agentName = process.env.DECISIONLOOP_AGENT ?? "mcp-client";
  const sessionId = process.env.DECISIONLOOP_SESSION_ID;
  const dl = new DecisionLoop({
    baseUrl: cfg.url,
    apiKey: key,
    agent: sessionId ? { name: agentName, sessionId, repository: cfg.project?.repository ?? repositoryName() } : null,
  });
  let who;
  try {
    who = await dl.operations.whoami();
  } catch (err) {
    fail(`cannot reach DecisionLoop at ${cfg.url}: ${err instanceof Error ? err.message : err}. Is \`decisionloop serve\` running?`);
  }
  const server = buildMcpServer(dl.operations, { type: who.type, scopes: who.scopes });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`decisionloop MCP (stdio) → ${cfg.url} as ${who.actor} (${who.type})\n`);
}

function defaultResources(positionals: string[]): { resources: string[]; repository: string | null } {
  const repository = loadConfig().project?.repository ?? repositoryName();
  const resources = positionals.length ? positionals : changedFiles();
  return { resources, repository };
}

async function cmdContext(args: string[], out: Out) {
  const { values, positionals } = parseArgs({ args, options: { intent: { type: "string" }, max: { type: "string" } }, allowPositionals: true });
  const { resources, repository } = defaultResources(positionals);
  const ctx = await client().context.get({
    intent: values.intent ?? `Work on ${resources.slice(0, 5).join(", ") || "this repository"}`,
    resources,
    repository,
    maxDecisions: values.max ? Number(values.max) : 5,
  });
  print(out, ctx, () => ctx.summary);
}

interface CheckResult {
  files: string[];
  dependencyChanges: DependencyChange[];
  findings: Array<{ decision: { id: string; externalRef: string | null; title: string }; constraint: string; explanation: string; severity: string }>;
  context: Awaited<ReturnType<DecisionLoop["context"]["get"]>> | null;
}

/** Local changes → engineering facts → recorded constraints and governing decisions. Read-only. */
async function runCheck(opts: { base: string; intent?: string; logContext?: boolean }): Promise<CheckResult> {
  const files = changedFiles(process.cwd(), opts.base);
  const repository = loadConfig().project?.repository ?? repositoryName();
  if (files.length === 0) return { files, dependencyChanges: [], findings: [], context: null };
  const dependencyChanges: DependencyChange[] = files
    .filter((f) => path.basename(f) === "package.json")
    .flatMap((f) => diffPackageJson(fileAtRevision(f, opts.base), fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null, f));
  const event = inboundEventSchema.parse({
    source: "local",
    externalId: "check",
    type: "working_tree.changed",
    occurredAt: new Date().toISOString(),
    actor: { type: "user", label: "decisionloop check" },
    payload: { repository, changedFiles: files.map((p) => ({ path: p, status: "modified" })), dependencyChanges },
    provenance: { receivedVia: "cli" },
  });
  const observed = engineeringPack.extract(event);
  const dl = client();
  const resourceInputs = observed.resources.filter((r) => r.type !== "repository");
  const [context, constraints] = await Promise.all([
    dl.context.get({ intent: opts.intent ?? "Review local changes before committing", resources: resourceInputs, repository }),
    dl.context.constraints(resourceInputs.length ? resourceInputs : files.map((f) => parseResource(f, repository)), repository),
  ]);
  const registry = new DomainRegistry([engineeringPack]);
  const findings = constraints.flatMap((c) => {
    const check = registry.evaluateConstraint(
      { id: c.constraintId, decisionId: c.decision.id, statement: c.statement, rule: c.rule as never, severity: c.severity as never, createdAt: "" },
      observed,
    );
    return check?.violated ? [{ decision: c.decision, constraint: c.statement, explanation: check.explanation, severity: c.severity }] : [];
  });
  return { files, dependencyChanges, findings, context };
}

function renderCheck(r: CheckResult): string {
  if (r.files.length === 0) return "No local changes to check.";
  return [
    `Checked ${r.files.length} changed file(s)${r.dependencyChanges.length ? ` and ${r.dependencyChanges.length} dependency change(s)` : ""}.`,
    r.findings.length
      ? r.findings.map((f) => `⚠ ${f.decision.externalRef ?? f.decision.title}: ${f.explanation}`).join("\n")
      : "No recorded constraint is violated by these changes.",
    "",
    r.context?.summary ?? "",
  ].join("\n");
}

async function cmdCheck(args: string[], out: Out) {
  const { values } = parseArgs({ args, options: { intent: { type: "string" }, strict: { type: "boolean" }, base: { type: "string" } } });
  const result = await runCheck({ base: values.base ?? "HEAD", intent: values.intent });
  print(out, result, () => renderCheck(result));
  if (values.strict && result.findings.length) process.exitCode = 2;
}

/**
 * Local development monitoring (spec §14): re-checks the working tree when
 * it changes and prints only when the governing decisions or findings
 * change. Polls git (no file-system watcher dependency); never writes memory.
 */
async function cmdWatch(args: string[]) {
  const { values } = parseArgs({ args, options: { interval: { type: "string" }, base: { type: "string" } } });
  const everyMs = Math.max(1, Number(values.interval ?? 5)) * 1000;
  const base = values.base ?? "HEAD";
  let lastTree = "";
  let lastReport = "";
  process.stderr.write(`decisionloop watch: checking changes against ${base} every ${everyMs / 1000}s (Ctrl+C to stop)\n`);
  for (;;) {
    const files = changedFiles(process.cwd(), base);
    const tree = files
      .map((f) => {
        try {
          return `${f}:${fs.statSync(f).mtimeMs}`;
        } catch {
          return `${f}:deleted`;
        }
      })
      .join("|");
    if (tree !== lastTree) {
      lastTree = tree;
      try {
        const r = await runCheck({ base, intent: "Local changes in progress" });
        const report = JSON.stringify({ f: r.findings.map((f) => f.explanation), d: r.context?.decisions.map((d) => `${d.id}:${d.status}`) ?? [] });
        if (report !== lastReport) {
          lastReport = report;
          process.stdout.write(`\n── ${new Date().toLocaleTimeString()} ─────────────────────────────\n${renderCheck(r)}\n`);
        }
      } catch (err) {
        process.stderr.write(`decisionloop watch: ${err instanceof Error ? err.message : err}\n`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

async function cmdDecisions(args: string[], out: Out) {
  const { values } = parseArgs({ args, options: { "at-risk": { type: "boolean" }, query: { type: "string" } } });
  const dl = client();
  if (values["at-risk"]) {
    const list = await dl.decisions.atRisk();
    print(out, list, () =>
      list.length
        ? list.map((r) => `${r.decision.externalRef ?? r.decision.id.slice(0, 8)}  ${r.decision.status}  ${r.decision.title}\n${r.compromisedAssumptions.map((a) => `    [${a.validityStatus}] ${a.statement}`).join("\n")}`).join("\n")
        : "No decisions are at risk.",
    );
    return;
  }
  const results = await dl.decisions.search(values.query ?? "decision", 50);
  print(out, results, () =>
    results.map((r) => `${(r.decision.externalRef ?? r.decision.id.slice(0, 8)).padEnd(10)} ${r.decision.status.padEnd(9)} ${r.decision.title}`).join("\n") ||
    "No decisions yet. Propose one with `decisionloop propose`.",
  );
}

async function cmdShow(args: string[], out: Out) {
  const id = args[0] ?? fail("usage: decisionloop show <id|ref>");
  const h = await client().decisions.get(id);
  print(out, h, () => {
    const d = h.decision;
    return [
      `${d.externalRef ? `${d.externalRef} — ` : ""}${d.title} [${d.status}]  id=${d.id}`,
      d.reasoning ? `Why: ${d.reasoning}` : "",
      ...d.options.map((o) => `${o.isChosen ? "✓" : "✗"} ${o.name}${o.rejectionReason ? ` — ${o.rejectionReason}` : ""}`),
      ...d.assumptions.map((a) => `  [${a.validityStatus}] ${a.statement}${a.normalizedStatement ? `  (${a.normalizedStatement})` : ""}`),
      ...(d.constraints ?? []).map((c) => `  constraint: ${c.statement}`),
      ...(d.verificationChecks ?? []).map((check) => {
        const latest = h.latestVerificationRuns.find((run) => run.checkName === check.name && run.repository === check.repository);
        return latest
          ? `  verification: ${check.repository} / ${check.name} — ${latest.conclusion} on ${latest.commitSha.slice(0, 12)}${latest.detailsUrl ? ` (${latest.detailsUrl})` : ""}`
          : `  verification: ${check.repository} / ${check.name} — no completed run recorded`;
      }),
      ...(d.resources ?? []).map((r) => `  governs: ${r.resourceType} ${r.resourceKey}`),
      "",
      "Timeline:",
      ...h.timeline.map((e) => `  ${e.createdAt.slice(0, 16).replace("T", " ")}  ${e.eventType}  ${e.summary ?? ""}`),
    ]
      .filter((l) => l !== "")
      .join("\n");
  });
}

async function cmdVerification(args: string[], out: Out) {
  const action = args[0];
  const decisionId = args[1] ?? fail("usage: decisionloop verification add <id|ref> --name <workflow> --repository <owner/repo>");
  if (action !== "add") fail("usage: decisionloop verification add <id|ref> --name <workflow> --repository <owner/repo>");
  const { values } = parseArgs({
    args: args.slice(2),
    options: {
      name: { type: "string" },
      repository: { type: "string" },
      kind: { type: "string" },
      description: { type: "string" },
    },
  });
  if (!values.name || !values.repository) fail("--name and --repository are required.");
  const decision = await client().decisions.configureVerificationCheck(decisionId, {
    name: values.name,
    repository: values.repository,
    kind: (values.kind ?? "TEST") as "TEST" | "BENCHMARK" | "RUNTIME",
    description: values.description,
  });
  print(out, decision, () => `Linked ${values.kind ?? "TEST"} workflow "${values.name}" in ${values.repository} to ${decision.externalRef ?? decision.title}.`);
}

async function cmdExplain(args: string[], out: Out) {
  const id = args[0] ?? fail("usage: decisionloop explain <id|ref>");
  const r = await client().decisions.explain(id);
  print(out, r, () => r.explanation);
}

async function cmdPropose(args: string[], out: Out) {
  const { values } = parseArgs({ args, options: { file: { type: "string" }, commit: { type: "boolean" } } });
  const raw = values.file ? fs.readFileSync(values.file, "utf8") : fs.readFileSync(0, "utf8");
  const draft = JSON.parse(raw);
  const dl = client();
  if (values.commit) {
    const d = await dl.decisions.create(draft);
    print(out, d, () => `Committed ${d.externalRef ?? d.id}: ${d.title}`);
    return;
  }
  const r = await dl.decisions.propose(draft);
  print(out, r, () =>
    [
      `Proposed ${r.decision.id}: ${r.decision.title} (approval ${r.approval.id} pending)`,
      ...r.related.map((x) => `${x.reintroducesRejectedAlternative ? "⚠" : "·"} ${x.externalRef ?? x.title}: ${x.reasons.join("; ")}`),
    ].join("\n"),
  );
}

async function cmdEvidence(args: string[], out: Out) {
  const [sub, ...rest] = args;
  if (sub !== "add") fail("usage: decisionloop evidence add --statement <text> [--fact <json>]… [--resource <r>]…");
  const { values } = parseArgs({
    args: rest,
    options: {
      statement: { type: "string" },
      text: { type: "string" },
      fact: { type: "string", multiple: true },
      resource: { type: "string", multiple: true },
      source: { type: "string" },
      kind: { type: "string" },
    },
  });
  if (!values.statement) fail("--statement is required.");
  const r = await client().evidence.add({
    statement: values.statement,
    text: values.text ?? null,
    facts: (values.fact ?? []).map((f) => JSON.parse(f)),
    resources: values.resource ?? [],
    sourceRef: values.source ?? null,
    kind: (values.kind as never) ?? undefined,
    repository: loadConfig().project?.repository ?? repositoryName(),
  });
  print(out, r, () => (r.created ? `Evidence queued as event ${r.eventId}.` : `Already recorded (event ${r.eventId}, ${r.status}).`));
}

async function cmdApprovals(args: string[], out: Out) {
  const [sub = "list", id, ...rest] = args;
  const { values } = parseArgs({ args: rest, options: { note: { type: "string" } }, allowPositionals: true });
  const dl = client();
  if (sub === "list") {
    const list = await dl.approvals.list();
    print(out, list, () =>
      list.length
        ? list.map((x) => `${x.approval.id}  ${x.approval.kind}  ${x.decision?.title ?? ""}\n    ${x.approval.reason}`).join("\n")
        : "No pending approvals.",
    );
    return;
  }
  const action = ({ approve: "approve", reject: "reject", evidence: "request_evidence", link: "link", supersede: "supersede_old" } as const)[sub as "approve"];
  if (!action || !id) fail("usage: decisionloop approvals [list | approve <id> | reject <id> | evidence <id>]");
  const r = await dl.approvals.resolve(id, action, values.note);
  print(out, r, () => `Approval ${r.id}: ${r.status}.`);
}

export async function main(argv: string[]): Promise<void> {
  const json = argv.includes("--json");
  const args = argv.filter((a) => a !== "--json");
  const [command, ...rest] = args;
  const out = { json };
  try {
    switch (command) {
      case "init":
        return await cmdInit(rest, out);
      case "serve":
        return await cmdServe(rest);
      case "worker":
        return await cmdWorker();
      case "login":
        return await cmdLogin(rest);
      case "doctor":
        return await cmdDoctor(out);
      case "key":
        return await cmdKey(rest, out);
      case "user":
        return await cmdUser(rest, out);
      case "mcp":
        return await cmdMcp();
      case "context":
        return await cmdContext(rest, out);
      case "check":
        return await cmdCheck(rest, out);
      case "watch":
        return await cmdWatch(rest);
      case "decisions":
        return await cmdDecisions(rest, out);
      case "show":
        return await cmdShow(rest, out);
      case "verification":
        return await cmdVerification(rest, out);
      case "explain":
        return await cmdExplain(rest, out);
      case "propose":
        return await cmdPropose(rest, out);
      case "evidence":
        return await cmdEvidence(rest, out);
      case "approvals":
        return await cmdApprovals(rest, out);
      case "hook": {
        const { runHook } = await import("./hooks");
        return await runHook(rest);
      }
      case undefined:
      case "help":
      case "--help":
      case "-h":
        process.stdout.write(`${HELP}\n`);
        return;
      default:
        fail(`unknown command "${command}". Run \`decisionloop help\`.`);
    }
  } catch (err) {
    if (err instanceof DecisionLoopApiError) {
      fail(err.code === "approval_required" ? err.message : `${err.code}: ${err.message}`, err.code === "approval_required" ? 0 : 1);
    }
    if (err instanceof TypeError && /fetch failed/i.test(err.message)) {
      fail(`cannot reach DecisionLoop at ${loadConfig().url}. Start it with \`decisionloop serve\` (or check DECISIONLOOP_URL).`);
    }
    fail(err instanceof Error ? err.message : String(err));
  }
}
