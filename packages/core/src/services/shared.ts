import type { DomainRegistry } from "../domain-packs/pack";
import type { PolicyRule } from "../policy/policy";
import type { EmbeddingProvider, ReasoningProvider } from "../ports/providers";
import type { DecisionStore } from "../ports/store";
import type { AgentIntent, AgentRun, DecisionWithDetails } from "../types/domain";
import type { Actor } from "../types/records";

export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

export interface ServiceDeps {
  store: DecisionStore;
  embeddings: EmbeddingProvider;
  reasoning: ReasoningProvider;
  domains: DomainRegistry;
  /** Policies that apply before any workspace override. */
  defaultPolicies: PolicyRule[];
  logger?: Logger;
}

export interface RunContext {
  run: AgentRun;
  stats: { retrieved: number; written: number; conflicts: number; retrievalLatencyMs: number };
  details: Record<string, unknown>;
}

/**
 * Every service execution that reads or writes memory is an `agent_runs`
 * row with real timings and counters, closed even when it throws — the same
 * contract as the 1.x `withAgentRun`, now storage-agnostic.
 */
export async function withRun<T>(
  store: DecisionStore,
  input: {
    tenantId: string;
    sessionId: string;
    intent: AgentIntent;
    request: string | null;
    agentSessionId?: string | null;
    eventId?: string | null;
    createdBy?: string | null;
  },
  fn: (ctx: RunContext) => Promise<{ result: T; summary?: string }>,
): Promise<{ result: T; runId: string }> {
  const started = Date.now();
  const run = await store.startRun(input);
  const ctx: RunContext = {
    run,
    stats: { retrieved: 0, written: 0, conflicts: 0, retrievalLatencyMs: 0 },
    details: {},
  };
  try {
    const { result, summary } = await fn(ctx);
    await store.completeRun(input.tenantId, run.id, {
      status: "SUCCEEDED",
      latencyMs: Date.now() - started,
      retrievalLatencyMs: ctx.stats.retrievalLatencyMs || null,
      memoriesRetrieved: ctx.stats.retrieved,
      memoriesWritten: ctx.stats.written,
      conflictsDetected: ctx.stats.conflicts,
      outputSummary: summary ?? null,
      details: ctx.details,
    });
    return { result, runId: run.id };
  } catch (err) {
    await store
      .completeRun(input.tenantId, run.id, {
        status: "FAILED",
        latencyMs: Date.now() - started,
        memoriesRetrieved: ctx.stats.retrieved,
        memoriesWritten: ctx.stats.written,
        conflictsDetected: ctx.stats.conflicts,
        error: err instanceof Error ? err.message : String(err),
        details: ctx.details,
      })
      .catch(() => undefined);
    throw err;
  }
}

export function sessionOf(actor: Actor): string {
  return actor.sessionId ?? `${actor.type}:${actor.apiKeyId ?? actor.userId ?? actor.label}`;
}

export function actorTypeForEvents(actor: Actor): "USER" | "AGENT" | "SYSTEM" {
  return actor.type === "user" ? "USER" : actor.type === "agent" ? "AGENT" : "SYSTEM";
}

/** The text a decision is remembered by — what vector retrieval matches against. */
export function decisionMemoryText(d: DecisionWithDetails): string {
  const chosen = d.options.find((o) => o.isChosen);
  return [
    `Decision${d.externalRef ? ` ${d.externalRef}` : ""}: ${d.title}`,
    d.problemStatement ? `Problem: ${d.problemStatement}` : "",
    chosen ? `Chosen: ${chosen.name}${chosen.description ? ` — ${chosen.description}` : ""}` : "",
    d.reasoning ? `Rationale: ${d.reasoning}` : "",
    ...d.options
      .filter((o) => !o.isChosen)
      .map((o) => `Rejected: ${o.name}${o.rejectionReason ? ` — ${o.rejectionReason}` : ""}`),
    d.resources?.length ? `Affects: ${d.resources.map((r) => r.resourceKey).join(", ")}` : "",
    d.tags.length ? `Tags: ${d.tags.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function assumptionMemoryText(d: DecisionWithDetails, a: DecisionWithDetails["assumptions"][number]): string {
  return [
    `Assumption behind "${d.title}": ${a.statement}`,
    a.normalizedStatement ? `Constraint: ${a.normalizedStatement}` : "",
    a.subject ? `Subject: ${a.subject}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const STOP = new Set(["a", "an", "the", "of", "for", "and", "or", "to", "with", "use", "using", "based", "backed"]);

function nameTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t))
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

/**
 * Whether two option names plausibly name the same approach ("Stateless
 * JWT" vs "stateless JWT tokens"). Deterministic token overlap; used to
 * flag a proposal that reintroduces a previously rejected alternative.
 */
export function namesMatch(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const smaller = Math.min(ta.size, tb.size);
  return shared / smaller >= 0.75 || shared / new Set([...ta, ...tb]).size >= 0.5;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
