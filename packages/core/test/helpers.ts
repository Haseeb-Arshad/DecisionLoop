import type { Sql } from "@decisionloop/storage-sql/connection";
import { createSql } from "@decisionloop/storage-sql/connection";
import { SqlDecisionStore } from "@decisionloop/storage-sql/store";
import { LexicalEmbeddingProvider } from "@decisionloop/providers";
import { createDecisionLoop, type DecisionLoop } from "@decisionloop/core/services/index";
import { NoReasoningProvider, type ReasoningProvider, type SemanticJudgment } from "@decisionloop/core/ports/providers";
import type { Actor, Scope } from "@decisionloop/core/types/records";
import { drainJobs } from "@decisionloop/core/services/worker";
import type { DecisionDraftInput } from "@decisionloop/core/contracts";
import type { DomainRegistry } from "@decisionloop/core/domain-packs/pack";

export interface TestEnv {
  sql: Sql;
  loop: DecisionLoop;
  drain(): Promise<number>;
  tenantIds: string[];
  close(): Promise<void>;
}

export async function createTestEnv(
  reasoning: ReasoningProvider = new NoReasoningProvider(),
  opts: { domains?: DomainRegistry; primaryDomain?: string } = {},
): Promise<TestEnv> {
  const sql = createSql(process.env.DATABASE_URL!, { max: 1 });
  const loop = createDecisionLoop({
    store: new SqlDecisionStore(sql),
    embeddings: new LexicalEmbeddingProvider(),
    reasoning,
    domains: opts.domains,
    primaryDomain: opts.primaryDomain,
  });
  const worker = loop.createWorker({ workerId: `test-${Math.random().toString(36).slice(2, 8)}`, batchSize: 10 });
  const tenantIds: string[] = [];
  return {
    sql,
    loop,
    tenantIds,
    drain: () => drainJobs(worker),
    async close() {
      if (tenantIds.length) {
        await sql`DELETE FROM jobs WHERE tenant_id IN ${sql(tenantIds)}`;
        await sql`DELETE FROM tenants WHERE id IN ${sql(tenantIds)}`;
      }
      await sql.end({ timeout: 5 });
    },
  };
}

export async function workspace(env: TestEnv, name: string) {
  const ws = await env.loop.store.createWorkspace(name);
  env.tenantIds.push(ws.id);
  const actor = (type: Actor["type"], scopes: Scope[], label: string, extra: Partial<Actor> = {}): Actor => ({
    tenantId: ws.id,
    type,
    userId: null,
    label,
    scopes,
    sessionId: `${label}-session`,
    ...extra,
  });
  return {
    id: ws.id,
    human: actor("user", ["admin"], "alice"),
    agent: actor("agent", ["read", "propose"], "claude-code"),
    powerfulAgent: actor("agent", ["admin"], "rogue-agent"),
    integration: actor("integration", ["read", "propose"], "github"),
    reader: actor("agent", ["read"], "read-only"),
  };
}

/** The spec's defining example: ADR-018, Redis-backed sessions. */
export function adr018(overrides: Partial<DecisionDraftInput> = {}): DecisionDraftInput {
  return {
    title: "Use Redis-backed server-side sessions for authentication",
    problem: "How do we store authenticated sessions for the product?",
    chosenOption: { name: "Server-side sessions in Redis", description: "Session ids in cookies; state in Redis" },
    alternatives: [
      { name: "Stateless JWT", rejectionReason: "Tokens cannot be revoked immediately; customers require instant revocation." },
    ],
    rationale: "Enterprise customers require immediate session revocation when an employee is offboarded.",
    assumptions: [
      {
        statement: "Customers require immediate session revocation",
        subject: "service:auth",
        predicate: "immediate_revocation_required",
        valueType: "BOOLEAN",
        operator: "=",
        expected: true,
        importance: 0.95,
        authority: 0.8,
      },
      {
        statement: "Redis is available in every production region",
        subject: "infrastructure:redis",
        predicate: "available_in_all_regions",
        valueType: "BOOLEAN",
        operator: "=",
        expected: true,
        importance: 0.8,
        authority: 0.8,
      },
      {
        statement: "Redis session lookup p95 stays under 15 ms",
        subject: "infrastructure:redis",
        predicate: "p95_latency_ms",
        valueType: "NUMBER",
        operator: "<",
        expected: 15,
        unit: "ms",
        importance: 0.6,
      },
    ],
    constraints: [
      { statement: "Sessions must stay server-side and revocable (Redis)", rule: { kind: "dependency_present", subject: "npm:redis" } },
    ],
    resources: ["src/auth/**", "src/session/**", "service:auth"],
    repository: "acme/product",
    externalRef: "ADR-018",
    importance: 0.9,
    tags: ["auth", "security"],
    ...overrides,
  };
}

/** A reasoning provider whose judgments are scripted per assumption statement. */
export class ScriptedReasoning implements ReasoningProvider {
  readonly name = "scripted";
  calls: string[] = [];
  constructor(private readonly script: (statement: string, evidence: string) => SemanticJudgment | null) {}
  async extractFacts() {
    return [];
  }
  async judge(input: Parameters<ReasoningProvider["judge"]>[0]): Promise<SemanticJudgment> {
    this.calls.push(input.assumption.statement);
    return (
      this.script(input.assumption.statement, input.evidenceText ?? "") ?? {
        relation: "IRRELEVANT",
        confidence: 0.9,
        explanation: "Unrelated.",
        quote: "",
      }
    );
  }
}
