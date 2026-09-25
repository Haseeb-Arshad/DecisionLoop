import crypto from "node:crypto";
import type postgres from "postgres";
import { canonicalForm, normalizeKey, type AssumptionSpec } from "@decisionloop/core/assumptions/model";
import type { InboundEvent, StoredEvent } from "@decisionloop/core/events/event";
import { assertTransition } from "@decisionloop/core/lifecycle/decisionStatus";
import { policyRuleSchema, type PolicyRule } from "@decisionloop/core/policy/policy";
import type {
  DecisionStore,
  NewConflictRecord,
  NewDecisionRecord,
  NewDependency,
  NewEvidenceRecord,
} from "@decisionloop/core/ports/store";
import type {
  AgentIntent,
  Assumption,
  AssumptionValidity,
  ConflictEvent,
  ConflictResolution,
  Decision,
  DecisionStatus,
  DecisionWithDetails,
  MemoryChunkCandidate,
  MemorySourceType,
} from "@decisionloop/core/types/domain";
import type {
  ApprovalStatus,
  AssumptionEvaluation,
  ConstraintFinding,
  Job,
  Scope,
} from "@decisionloop/core/types/records";
import type { Sql } from "./connection";
import {
  mapAssumption,
  mapConstraint,
  mapDecision,
  mapOption,
  mapResource,
} from "./mappers";
import {
  json,
  mapApiKey,
  mapApproval,
  mapBinding,
  mapConflictRow,
  mapDependency,
  mapEvaluation,
  mapEvent,
  mapEvidenceItem,
  mapFinding,
  mapJob,
  mapMemoryEvent,
  mapRun,
  mapSession,
} from "./recordMappers";

type Q = Sql | postgres.TransactionSql;

export const EMBEDDING_DIMENSIONS = 512;

/** JSON parameters are sent as text and cast, which is identical on CockroachDB and PostgreSQL. */
const j = (v: unknown): string | null => (v === null || v === undefined ? null : JSON.stringify(v));

function vectorLiteral(embedding: number[]): string {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding has ${embedding.length} dimensions; memory_chunks.embedding is VECTOR(${EMBEDDING_DIMENSIONS}).`,
    );
  }
  return `[${embedding.join(",")}]`;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace"
  );
}

const LIVE_DECISION_STATUSES: DecisionStatus[] = ["ACTIVE", "AT_RISK", "REOPENED"];

function assumptionTypeFor(spec: AssumptionSpec): string {
  if (spec.assumptionType) return spec.assumptionType;
  switch (spec.valueType) {
    case "NUMBER":
      return "QUANTITATIVE";
    case "DATE":
      return "TEMPORAL";
    default:
      return "QUALITATIVE";
  }
}

/**
 * DecisionStore over postgres.js, for CockroachDB and PostgreSQL + pgvector.
 *
 * Every workspace query carries `tenant_id` in its WHERE clause. Child rows
 * without a tenant column (options, assumptions) are always reached through
 * a tenant-scoped join on their decision.
 */
export class SqlDecisionStore implements DecisionStore {
  constructor(
    private readonly q: Q,
    private readonly inTransaction = false,
  ) {}

  async transaction<T>(fn: (tx: DecisionStore) => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn(this);
    const result = await (this.q as Sql).begin((tx) => fn(new SqlDecisionStore(tx, true)));
    return result as T;
  }

  // ── Machine credentials ──────────────────────────────────────────────────

  async createApiKey(input: Parameters<DecisionStore["createApiKey"]>[0]) {
    const [row] = await this.q`
      INSERT INTO api_keys (tenant_id, name, key_prefix, key_hash, scopes, actor_type, created_by)
      VALUES (${input.tenantId}, ${input.name}, ${input.keyPrefix}, ${input.keyHash},
              ${input.scopes}::text[], ${input.actorType}, ${input.createdBy ?? null})
      RETURNING *
    `;
    return mapApiKey(row!);
  }

  async findApiKeyByHash(keyHash: string) {
    const [row] = await this.q`
      SELECT * FROM api_keys WHERE key_hash = ${keyHash} AND revoked_at IS NULL
    `;
    return row ? mapApiKey(row) : null;
  }

  async touchApiKey(id: string) {
    await this.q`UPDATE api_keys SET last_used_at = now() WHERE id = ${id}`;
  }

  async revokeApiKey(tenantId: string, id: string) {
    await this.q`UPDATE api_keys SET revoked_at = now() WHERE id = ${id} AND tenant_id = ${tenantId}`;
  }

  async listApiKeys(tenantId: string) {
    const rows = await this.q`SELECT * FROM api_keys WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`;
    return rows.map(mapApiKey);
  }

  // ── Workspaces ───────────────────────────────────────────────────────────

  async createWorkspace(name: string) {
    const slug = `${slugify(name)}-${crypto.randomBytes(3).toString("hex")}`;
    const [row] = await this.q`
      INSERT INTO tenants (name, slug) VALUES (${name}, ${slug}) RETURNING id, name, slug
    `;
    return { id: row!.id as string, name: row!.name as string, slug: row!.slug as string };
  }

  async getWorkspace(id: string) {
    const [row] = await this.q`SELECT id, name, slug FROM tenants WHERE id = ${id}`;
    return row ? { id: row.id as string, name: row.name as string, slug: row.slug as string } : null;
  }

  async findWorkspaceBySlug(slug: string) {
    const [row] = await this.q`SELECT id, name, slug FROM tenants WHERE slug = ${slug}`;
    return row ? { id: row.id as string, name: row.name as string, slug: row.slug as string } : null;
  }

  async getOrCreateDefaultProject(tenantId: string) {
    const [existing] = await this.q`
      SELECT id, name FROM projects
      WHERE tenant_id = ${tenantId} AND archived_at IS NULL
      ORDER BY created_at ASC LIMIT 1
    `;
    if (existing) return { id: existing.id as string, name: existing.name as string };
    const [row] = await this.q`
      INSERT INTO projects (tenant_id, name, description)
      VALUES (${tenantId}, 'General', 'Default project for decisions that have not been filed elsewhere.')
      RETURNING id, name
    `;
    return { id: row!.id as string, name: row!.name as string };
  }

  // ── Decisions ────────────────────────────────────────────────────────────

  async insertDecision(input: NewDecisionRecord): Promise<DecisionWithDetails> {
    return this.transaction(async (txStore) => {
      const tx = (txStore as SqlDecisionStore).q;
      if (input.projectId) {
        const [project] = await tx`
          SELECT id FROM projects WHERE id = ${input.projectId} AND tenant_id = ${input.tenantId}
        `;
        if (!project) throw new Error("Project not found in this workspace.");
      }

      const [decisionRow] = await tx`
        INSERT INTO decisions (
          tenant_id, project_id, title, problem_statement, reasoning, status,
          confidence, importance, created_by, created_in_session,
          domain, scope, origin, decided_by_type, decided_by_label, external_ref,
          tags, metadata, source_refs, valid_from, agent_session_id, memory_index_status
        ) VALUES (
          ${input.tenantId}, ${input.projectId}, ${input.title}, ${input.problemStatement},
          ${input.reasoning}, ${input.status}, ${input.confidence}, ${input.importance},
          ${input.createdBy}, ${input.createdInSession},
          ${input.domain}, ${input.scope}, ${input.origin}, ${input.decidedByType},
          ${input.decidedByLabel}, ${input.externalRef},
          ${input.tags}::text[], ${j(input.metadata)}::jsonb, ${j(input.sourceRefs)}::jsonb,
          ${input.status === "ACTIVE" ? new Date() : null}, ${input.agentSessionId}, 'PENDING'
        )
        RETURNING *
      `;
      const decision = mapDecision(decisionRow!);

      for (const opt of input.options) {
        await tx`
          INSERT INTO decision_options (decision_id, name, description, is_chosen, rejection_reason)
          VALUES (${decision.id}, ${opt.name}, ${opt.description}, ${opt.isChosen}, ${opt.rejectionReason})
        `;
      }
      for (const spec of input.assumptions) {
        await (txStore as SqlDecisionStore).insertAssumptionRow(decision.id, spec);
      }
      for (const r of input.resources) {
        await tx`
          INSERT INTO decision_resources (tenant_id, decision_id, resource_type, resource_key, repository)
          VALUES (${input.tenantId}, ${decision.id}, ${r.type}, ${r.key}, ${r.repository ?? null})
          ON CONFLICT (decision_id, resource_type, resource_key, relationship) DO NOTHING
        `;
      }
      for (const c of input.constraints) {
        await tx`
          INSERT INTO decision_constraints (tenant_id, decision_id, statement, rule, severity)
          VALUES (${input.tenantId}, ${decision.id}, ${c.statement}, ${j(c.rule)}::jsonb, ${c.severity})
        `;
      }

      const full = await txStore.getDecision(input.tenantId, decision.id);
      if (!full) throw new Error("Decision insert did not persist.");
      return full;
    });
  }

  private async insertAssumptionRow(decisionId: string, spec: AssumptionSpec): Promise<Assumption> {
    const predicate = normalizeKey(spec.predicate);
    const subject = normalizeKey(spec.subject);
    const numeric = spec.valueType === "NUMBER" && typeof spec.expected === "number";
    const [row] = await this.q`
      INSERT INTO assumptions (
        decision_id, statement, normalized_statement, assumption_type,
        metric, operator, value, unit, importance, confidence, authority_score,
        valid_from, valid_until, subject, predicate, value_type, expected,
        verification_policy, provenance
      ) VALUES (
        ${decisionId}, ${spec.statement},
        ${canonicalForm({ ...spec, subject, predicate })},
        ${assumptionTypeFor(spec)},
        ${numeric ? predicate : null}, ${spec.operator ?? null},
        ${numeric ? (spec.expected as number) : null}, ${spec.unit ?? null},
        ${spec.importance}, ${spec.confidence}, ${spec.authority},
        ${spec.validFrom ? new Date(spec.validFrom) : new Date()},
        ${spec.validUntil ? new Date(spec.validUntil) : null},
        ${subject}, ${predicate}, ${spec.valueType},
        ${j(spec.expected ?? null)}::jsonb, ${spec.verificationPolicy},
        ${j(spec.provenance ?? null)}::jsonb
      )
      RETURNING *
    `;
    return mapAssumption(row!);
  }

  async getDecision(tenantId: string, id: string): Promise<DecisionWithDetails | null> {
    const [row] = await this.q`SELECT * FROM decisions WHERE id = ${id} AND tenant_id = ${tenantId}`;
    if (!row) return null;
    const [hydrated] = await this.hydrate(tenantId, [row]);
    return hydrated ?? null;
  }

  async getDecisionByExternalRef(tenantId: string, ref: string) {
    const [row] = await this.q`
      SELECT * FROM decisions WHERE tenant_id = ${tenantId} AND lower(external_ref) = ${ref.toLowerCase()}
      ORDER BY created_at DESC LIMIT 1
    `;
    if (!row) return null;
    const [hydrated] = await this.hydrate(tenantId, [row]);
    return hydrated ?? null;
  }

  async listDecisions(
    tenantId: string,
    opts: { statuses?: DecisionStatus[]; ids?: string[]; domain?: string; limit?: number } = {},
  ) {
    if (opts.ids && opts.ids.length === 0) return [];
    const rows = await this.q`
      SELECT * FROM decisions
      WHERE tenant_id = ${tenantId}
        ${opts.statuses?.length ? this.q`AND status IN ${this.q(opts.statuses)}` : this.q``}
        ${opts.ids?.length ? this.q`AND id IN ${this.q(opts.ids)}` : this.q``}
        ${opts.domain ? this.q`AND domain = ${opts.domain}` : this.q``}
      ORDER BY CASE status WHEN 'AT_RISK' THEN 0 WHEN 'REOPENED' THEN 1 ELSE 2 END, updated_at DESC
      LIMIT ${opts.limit ?? 200}
    `;
    return this.hydrate(tenantId, rows);
  }

  private async hydrate(tenantId: string, rows: readonly Record<string, unknown>[]): Promise<DecisionWithDetails[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id as string);
    // Child tables are reached only through decision ids already proven to
    // belong to this tenant by the parent query above.
    const [options, assumptions, resources, constraints] = await Promise.all([
      this.q`SELECT * FROM decision_options WHERE decision_id IN ${this.q(ids)} ORDER BY created_at`,
      this.q`SELECT * FROM assumptions WHERE decision_id IN ${this.q(ids)} ORDER BY created_at`,
      this.q`SELECT * FROM decision_resources WHERE tenant_id = ${tenantId} AND decision_id IN ${this.q(ids)} ORDER BY created_at`,
      this.q`SELECT * FROM decision_constraints WHERE tenant_id = ${tenantId} AND decision_id IN ${this.q(ids)} ORDER BY created_at`,
    ]);
    return rows.map((row) => {
      const d = mapDecision(row);
      return {
        ...d,
        options: options.filter((o) => o.decision_id === d.id).map(mapOption),
        assumptions: assumptions.filter((a) => a.decision_id === d.id).map(mapAssumption),
        resources: resources.filter((r) => r.decision_id === d.id).map(mapResource),
        constraints: constraints.filter((c) => c.decision_id === d.id).map(mapConstraint),
      };
    });
  }

  async updateDecisionStatus(
    tenantId: string,
    id: string,
    to: DecisionStatus,
    opts: { riskExplanation?: string | null; supersededByDecisionId?: string | null } = {},
  ): Promise<Decision> {
    const [current] = await this.q`
      SELECT status FROM decisions WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!current) throw new Error(`Decision ${id} not found in this workspace.`);
    assertTransition(current.status as DecisionStatus, to);
    const [row] = await this.q`
      UPDATE decisions SET
        status = ${to},
        risk_explanation = ${opts.riskExplanation === undefined ? null : opts.riskExplanation},
        superseded_by_decision_id = COALESCE(${opts.supersededByDecisionId ?? null}, superseded_by_decision_id),
        reopened_at = CASE WHEN ${to} = 'REOPENED' THEN now() ELSE reopened_at END,
        closed_at = CASE WHEN ${to} IN ('SUPERSEDED', 'ARCHIVED') THEN now() ELSE closed_at END,
        valid_from = CASE WHEN ${to} = 'ACTIVE' AND valid_from IS NULL THEN now() ELSE valid_from END,
        updated_at = now()
      WHERE id = ${id} AND tenant_id = ${tenantId}
      RETURNING *
    `;
    return mapDecision(row!);
  }

  async markDecisionReviewed(tenantId: string, id: string) {
    await this.q`UPDATE decisions SET reviewed_at = now() WHERE id = ${id} AND tenant_id = ${tenantId}`;
  }

  async setMemoryIndexStatus(tenantId: string, id: string, status: "PENDING" | "INDEXED" | "FAILED", error?: string | null) {
    await this.q`
      UPDATE decisions SET
        memory_index_status = ${status},
        memory_index_error = ${error ?? null},
        memory_indexed_at = CASE WHEN ${status} = 'INDEXED' THEN now() ELSE memory_indexed_at END
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
  }

  async listResourcesForMatching(
    tenantId: string,
    opts: { types?: string[]; statuses?: DecisionStatus[]; limit?: number },
  ) {
    const statuses = opts.statuses ?? LIVE_DECISION_STATUSES;
    const rows = await this.q`
      SELECT r.* FROM decision_resources r
      JOIN decisions d ON d.id = r.decision_id AND d.tenant_id = r.tenant_id
      WHERE r.tenant_id = ${tenantId}
        AND d.status IN ${this.q(statuses)}
        ${opts.types?.length ? this.q`AND r.resource_type IN ${this.q(opts.types)}` : this.q``}
      LIMIT ${opts.limit ?? 5000}
    `;
    return rows.map(mapResource);
  }

  // ── Assumptions ──────────────────────────────────────────────────────────

  async getAssumption(tenantId: string, id: string) {
    const [row] = await this.q`
      SELECT a.* FROM assumptions a JOIN decisions d ON d.id = a.decision_id
      WHERE a.id = ${id} AND d.tenant_id = ${tenantId}
    `;
    return row ? mapAssumption(row) : null;
  }

  async addAssumption(tenantId: string, decisionId: string, spec: AssumptionSpec) {
    const [decision] = await this.q`SELECT id FROM decisions WHERE id = ${decisionId} AND tenant_id = ${tenantId}`;
    if (!decision) throw new Error("Decision not found in this workspace.");
    return this.insertAssumptionRow(decisionId, spec);
  }

  async findAssumptionsByPredicates(tenantId: string, predicates: string[]) {
    const keys = Array.from(new Set(predicates.map((p) => normalizeKey(p)).filter((p): p is string => Boolean(p))));
    if (keys.length === 0) return [];
    const rows = await this.q`
      SELECT a.* FROM assumptions a
      JOIN decisions d ON d.id = a.decision_id
      WHERE d.tenant_id = ${tenantId}
        AND d.status IN ${this.q(LIVE_DECISION_STATUSES)}
        AND a.validity_status IN ('VALID', 'UNCERTAIN', 'CHALLENGED')
        AND (a.predicate IN ${this.q(keys)} OR (a.predicate IS NULL AND lower(a.metric) IN ${this.q(keys)}))
      LIMIT 200
    `;
    return rows.map(mapAssumption);
  }

  async setAssumptionValidity(
    tenantId: string,
    id: string,
    validity: AssumptionValidity,
    opts: { evidenceItemId?: string | null } = {},
  ) {
    const rows = await this.q`
      UPDATE assumptions SET
        validity_status = ${validity},
        challenged_at = CASE WHEN ${validity} = 'CHALLENGED' THEN now() ELSE challenged_at END,
        invalidated_at = CASE WHEN ${validity} = 'INVALIDATED' THEN now() ELSE invalidated_at END,
        invalidated_by_evidence_id = CASE WHEN ${validity} = 'INVALIDATED'
          THEN COALESCE(${opts.evidenceItemId ?? null}, invalidated_by_evidence_id)
          ELSE invalidated_by_evidence_id END
      WHERE id = ${id}
        AND decision_id IN (SELECT id FROM decisions WHERE tenant_id = ${tenantId})
      RETURNING id
    `;
    if (rows.length === 0) throw new Error(`Assumption ${id} not found in this workspace.`);
  }

  async touchAssumptionEvaluated(tenantId: string, ids: string[]) {
    if (ids.length === 0) return;
    await this.q`
      UPDATE assumptions SET last_evaluated_at = now()
      WHERE id IN ${this.q(ids)}
        AND decision_id IN (SELECT id FROM decisions WHERE tenant_id = ${tenantId})
    `;
  }

  // ── Memory surface ───────────────────────────────────────────────────────

  async replaceDecisionMemory(
    tenantId: string,
    decisionId: string,
    chunks: Parameters<DecisionStore["replaceDecisionMemory"]>[2],
  ) {
    // Delete + insert in one transaction: a crash can no longer leave a
    // decision with no retrievable memory (docs/v2 §4.10).
    return this.transaction(async (txStore) => {
      const tx = (txStore as SqlDecisionStore).q;
      const [decision] = await tx`
        SELECT id, project_id FROM decisions WHERE id = ${decisionId} AND tenant_id = ${tenantId}
      `;
      if (!decision) throw new Error("Decision not found in this workspace.");
      await tx`
        DELETE FROM memory_chunks
        WHERE tenant_id = ${tenantId} AND decision_id = ${decisionId}
          AND source_type IN ('decision', 'assumption')
      `;
      for (const [i, c] of chunks.entries()) {
        await tx`
          INSERT INTO memory_chunks (
            tenant_id, project_id, source_type, source_id, decision_id, content,
            embedding, embedding_model, chunk_index, content_hash, importance,
            authority_score, origin_session_id
          ) VALUES (
            ${tenantId}, ${decision.project_id as string | null}, ${c.sourceType}, ${c.sourceId},
            ${decisionId}, ${c.content}, ${vectorLiteral(c.embedding)}::VECTOR(512),
            ${c.embeddingModel}, ${i}, ${crypto.createHash("sha256").update(c.content).digest("hex")},
            ${c.importance}, ${c.authorityScore}, ${c.originSessionId}
          )
        `;
      }
      return chunks.length;
    });
  }

  async searchMemory(
    tenantId: string,
    embedding: number[],
    opts: { limit: number; sourceType?: MemorySourceType; embeddingModel?: string },
  ) {
    const literal = vectorLiteral(embedding);
    const startedAt = Date.now();
    const rows = await this.q`
      SELECT id, source_type, source_id, decision_id, content, importance, authority_score,
             page_number, created_at, origin_session_id,
             1 - (embedding <=> ${literal}::VECTOR(512)) AS similarity
      FROM memory_chunks
      WHERE tenant_id = ${tenantId}
        ${opts.sourceType ? this.q`AND source_type = ${opts.sourceType}` : this.q``}
        ${opts.embeddingModel ? this.q`AND embedding_model = ${opts.embeddingModel}` : this.q``}
      ORDER BY embedding <=> ${literal}::VECTOR(512)
      LIMIT ${opts.limit}
    `;
    const latencyMs = Date.now() - startedAt;
    const candidates: MemoryChunkCandidate[] = rows.map((row) => ({
      chunkId: row.id as string,
      sourceType: row.source_type as MemorySourceType,
      sourceId: row.source_id as string,
      decisionId: (row.decision_id as string) ?? null,
      contentPreview: String(row.content).slice(0, 240),
      similarity: Number(row.similarity),
      importance: Number(row.importance ?? 0.5),
      authorityScore: Number(row.authority_score ?? 0.6),
      pageNumber: row.page_number === null ? null : Number(row.page_number),
      createdAt: new Date(row.created_at as Date).toISOString(),
      originSessionId: (row.origin_session_id as string | null) ?? null,
    }));
    const renderedSql = [
      "SELECT id, source_type, source_id, decision_id, content, importance, authority_score,",
      "       page_number, created_at, origin_session_id,",
      "       1 - (embedding <=> $1::VECTOR(512)) AS similarity",
      "FROM memory_chunks",
      "WHERE tenant_id = $2",
      opts.sourceType ? `  AND source_type = '${opts.sourceType}'` : "",
      opts.embeddingModel ? `  AND embedding_model = '${opts.embeddingModel}'` : "",
      "ORDER BY embedding <=> $1::VECTOR(512)",
      `LIMIT ${opts.limit};`,
      "",
      `-- $1 = query embedding (${embedding.length} dims, values omitted)`,
      `-- $2 = '${tenantId}'`,
      `-- executed in ${latencyMs}ms`,
    ]
      .filter(Boolean)
      .join("\n");
    return { candidates, renderedSql, latencyMs };
  }

  // ── Events and evidence ──────────────────────────────────────────────────

  async insertEvent(tenantId: string, event: InboundEvent) {
    const inserted = await this.q`
      INSERT INTO event_inbox (
        tenant_id, source, external_id, event_type, occurred_at, actor, resources, facts,
        body_text, subject, evidence_kind, payload, provenance
      ) VALUES (
        ${tenantId}, ${event.source}, ${event.externalId}, ${event.type}, ${new Date(event.occurredAt)},
        ${j(event.actor)}::jsonb, ${j(event.resources)}::jsonb, ${j(event.facts)}::jsonb,
        ${event.text ?? null}, ${event.subject ?? null}, ${event.evidenceKind},
        ${j(event.payload)}::jsonb, ${j(event.provenance)}::jsonb
      )
      ON CONFLICT (tenant_id, source, external_id) DO NOTHING
      RETURNING *
    `;
    if (inserted[0]) return { event: mapEvent(inserted[0]), created: true };
    const [existing] = await this.q`
      SELECT * FROM event_inbox
      WHERE tenant_id = ${tenantId} AND source = ${event.source} AND external_id = ${event.externalId}
    `;
    return { event: mapEvent(existing!), created: false };
  }

  async getEvent(tenantId: string, id: string) {
    const [row] = await this.q`SELECT * FROM event_inbox WHERE id = ${id} AND tenant_id = ${tenantId}`;
    return row ? mapEvent(row) : null;
  }

  async listEvents(tenantId: string, opts: { limit?: number; status?: string } = {}) {
    const rows = await this.q`
      SELECT * FROM event_inbox WHERE tenant_id = ${tenantId}
        ${opts.status ? this.q`AND status = ${opts.status}` : this.q``}
      ORDER BY received_at DESC LIMIT ${opts.limit ?? 50}
    `;
    return rows.map(mapEvent);
  }

  async updateEventStatus(
    tenantId: string,
    id: string,
    status: StoredEvent["status"],
    opts: { error?: string | null; result?: Record<string, unknown> | null; incrementAttempts?: boolean } = {},
  ) {
    await this.q`
      UPDATE event_inbox SET
        status = ${status},
        attempts = attempts + ${opts.incrementAttempts ? 1 : 0},
        last_error = ${opts.error ?? null},
        result = COALESCE(${j(opts.result ?? null)}::jsonb, result),
        processed_at = CASE WHEN ${status} IN ('PROCESSED', 'IGNORED') THEN now() ELSE processed_at END
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
  }

  async insertEvidence(input: NewEvidenceRecord) {
    const inserted = await this.q`
      INSERT INTO evidence_items (
        tenant_id, project_id, event_id, document_id, kind, source, source_ref, subject,
        authority, confidence, occurred_at, content, content_hash, facts, resources,
        provenance, actor, supersedes_evidence_id
      ) VALUES (
        ${input.tenantId}, ${input.projectId}, ${input.eventId}, ${input.documentId ?? null},
        ${input.kind}, ${input.source}, ${input.sourceRef}, ${input.subject},
        ${input.authority}, ${input.confidence}, ${new Date(input.occurredAt)}, ${input.content},
        ${input.contentHash}, ${j(input.facts)}::jsonb, ${j(input.resources)}::jsonb,
        ${j(input.provenance)}::jsonb, ${j(input.actor)}::jsonb, ${input.supersedesEvidenceId ?? null}
      )
      ON CONFLICT (tenant_id, source, content_hash) DO NOTHING
      RETURNING *
    `;
    if (inserted[0]) return { evidence: mapEvidenceItem(inserted[0]), created: true };
    const [existing] = await this.q`
      SELECT * FROM evidence_items
      WHERE tenant_id = ${input.tenantId} AND source = ${input.source} AND content_hash = ${input.contentHash}
    `;
    return { evidence: mapEvidenceItem(existing!), created: false };
  }

  async getEvidence(tenantId: string, id: string) {
    const [row] = await this.q`SELECT * FROM evidence_items WHERE id = ${id} AND tenant_id = ${tenantId}`;
    return row ? mapEvidenceItem(row) : null;
  }

  async listEvidence(tenantId: string, opts: { limit?: number; eventId?: string } = {}) {
    const rows = await this.q`
      SELECT * FROM evidence_items WHERE tenant_id = ${tenantId}
        ${opts.eventId ? this.q`AND event_id = ${opts.eventId}` : this.q``}
      ORDER BY ingested_at DESC LIMIT ${opts.limit ?? 50}
    `;
    return rows.map(mapEvidenceItem);
  }

  async linkEvidenceToDecision(input: Parameters<DecisionStore["linkEvidenceToDecision"]>[0]) {
    await this.q`
      INSERT INTO decision_evidence (
        tenant_id, decision_id, assumption_id, evidence_item_id, evidence_type, relevance, excerpt
      )
      SELECT ${input.tenantId}, d.id, ${input.assumptionId}, ${input.evidenceItemId},
             ${input.evidenceType}, ${input.relevance}, ${input.excerpt}
      FROM decisions d WHERE d.id = ${input.decisionId} AND d.tenant_id = ${input.tenantId}
    `;
  }

  // ── Evaluations, conflicts, findings ─────────────────────────────────────

  async insertEvaluation(input: Omit<AssumptionEvaluation, "id" | "createdAt">) {
    const [row] = await this.q`
      INSERT INTO assumption_evaluations (
        tenant_id, agent_run_id, event_id, evidence_item_id, assumption_id, decision_id, fact,
        method, relation, confidence, evidence_authority, assumption_authority,
        previous_validity, next_validity, decision_flagged, matched_policies, actions,
        explanation, retrieval_score
      ) VALUES (
        ${input.tenantId}, ${input.agentRunId}, ${input.eventId}, ${input.evidenceItemId},
        ${input.assumptionId}, ${input.decisionId}, ${j(input.fact)}::jsonb,
        ${input.method}, ${input.relation}, ${input.confidence}, ${input.evidenceAuthority},
        ${input.assumptionAuthority}, ${input.previousValidity}, ${input.nextValidity},
        ${input.decisionFlagged}, ${j(input.matchedPolicies)}::jsonb, ${j(input.actions)}::jsonb,
        ${input.explanation}, ${input.retrievalScore}
      )
      RETURNING *
    `;
    return mapEvaluation(row!);
  }

  async listEvaluations(
    tenantId: string,
    opts: { eventId?: string; assumptionId?: string; decisionId?: string; limit?: number },
  ) {
    const rows = await this.q`
      SELECT * FROM assumption_evaluations WHERE tenant_id = ${tenantId}
        ${opts.eventId ? this.q`AND event_id = ${opts.eventId}` : this.q``}
        ${opts.assumptionId ? this.q`AND assumption_id = ${opts.assumptionId}` : this.q``}
        ${opts.decisionId ? this.q`AND decision_id = ${opts.decisionId}` : this.q``}
      ORDER BY created_at DESC LIMIT ${opts.limit ?? 100}
    `;
    return rows.map(mapEvaluation);
  }

  async insertConflict(input: NewConflictRecord) {
    const inserted = await this.q`
      INSERT INTO conflict_events (
        tenant_id, decision_id, assumption_id, evidence_item_id, event_id, evaluation_id,
        agent_run_id, fact_statement, explanation, conflict_type, relation, confidence,
        old_value, new_value, source_quote, detection_method, memory_trace_id
      )
      SELECT ${input.tenantId}, d.id, ${input.assumptionId}, ${input.evidenceItemId}, ${input.eventId},
             ${input.evaluationId}, ${input.agentRunId}, ${input.factStatement}, ${input.explanation},
             ${input.conflictType}, ${input.relation}, ${input.confidence}, ${input.oldValue},
             ${input.newValue}, ${input.sourceQuote}, ${input.detectionMethod}, ${input.memoryTraceId ?? null}
      FROM decisions d WHERE d.id = ${input.decisionId} AND d.tenant_id = ${input.tenantId}
      ON CONFLICT (tenant_id, assumption_id, evidence_item_id) DO NOTHING
      RETURNING *
    `;
    if (inserted[0]) return { conflict: mapConflictRow(inserted[0]) as ConflictEvent, created: true };
    const [existing] = await this.q`
      SELECT * FROM conflict_events
      WHERE tenant_id = ${input.tenantId} AND assumption_id = ${input.assumptionId}
        AND evidence_item_id = ${input.evidenceItemId}
    `;
    if (!existing) throw new Error("Conflict could not be recorded (decision not in this workspace).");
    return { conflict: mapConflictRow(existing) as ConflictEvent, created: false };
  }

  async getConflict(tenantId: string, id: string) {
    const [row] = await this.q`SELECT * FROM conflict_events WHERE id = ${id} AND tenant_id = ${tenantId}`;
    return row ? (mapConflictRow(row) as ConflictEvent) : null;
  }

  async listConflicts(
    tenantId: string,
    opts: { decisionId?: string; decisionIds?: string[]; unresolvedOnly?: boolean; limit?: number } = {},
  ) {
    if (opts.decisionIds && opts.decisionIds.length === 0) return [];
    const rows = await this.q`
      SELECT * FROM conflict_events WHERE tenant_id = ${tenantId}
        ${opts.decisionId ? this.q`AND decision_id = ${opts.decisionId}` : this.q``}
        ${opts.decisionIds?.length ? this.q`AND decision_id IN ${this.q(opts.decisionIds)}` : this.q``}
        ${opts.unresolvedOnly ? this.q`AND resolution IS NULL` : this.q``}
      ORDER BY detected_at DESC LIMIT ${opts.limit ?? 100}
    `;
    return rows.map((r) => mapConflictRow(r) as ConflictEvent);
  }

  async resolveConflict(
    tenantId: string,
    id: string,
    resolution: ConflictResolution,
    by: { userId: string | null; label: string; note?: string | null },
  ) {
    const [row] = await this.q`
      UPDATE conflict_events SET
        resolution = ${resolution}, resolved_by = ${by.userId}, resolved_by_label = ${by.label},
        resolution_note = ${by.note ?? null}, reviewed_at = now()
      WHERE id = ${id} AND tenant_id = ${tenantId}
      RETURNING *
    `;
    if (!row) throw new Error(`Conflict ${id} not found in this workspace.`);
    return mapConflictRow(row) as ConflictEvent;
  }

  async insertConstraintFinding(input: Parameters<DecisionStore["insertConstraintFinding"]>[0]) {
    const inserted = await this.q`
      INSERT INTO constraint_findings (tenant_id, decision_id, constraint_id, event_id, evidence_item_id, explanation)
      SELECT ${input.tenantId}, c.decision_id, c.id, ${input.eventId}, ${input.evidenceItemId}, ${input.explanation}
      FROM decision_constraints c
      WHERE c.id = ${input.constraintId} AND c.tenant_id = ${input.tenantId} AND c.decision_id = ${input.decisionId}
      ON CONFLICT (tenant_id, constraint_id, event_id) DO NOTHING
      RETURNING *
    `;
    if (inserted[0]) return { finding: mapFinding(inserted[0]), created: true };
    const [existing] = await this.q`
      SELECT * FROM constraint_findings
      WHERE tenant_id = ${input.tenantId} AND constraint_id = ${input.constraintId} AND event_id = ${input.eventId}
    `;
    if (!existing) throw new Error("Constraint not found in this workspace.");
    return { finding: mapFinding(existing), created: false };
  }

  async listConstraintFindings(tenantId: string, opts: { eventId?: string; status?: string; limit?: number } = {}) {
    const rows = await this.q`
      SELECT * FROM constraint_findings WHERE tenant_id = ${tenantId}
        ${opts.eventId ? this.q`AND event_id = ${opts.eventId}` : this.q``}
        ${opts.status ? this.q`AND status = ${opts.status}` : this.q``}
      ORDER BY created_at DESC LIMIT ${opts.limit ?? 100}
    `;
    return rows.map(mapFinding);
  }

  async resolveConstraintFinding(
    tenantId: string,
    id: string,
    status: ConstraintFinding["status"],
    by: { label: string; note?: string | null },
  ) {
    const [row] = await this.q`
      UPDATE constraint_findings SET status = ${status}, resolved_by_label = ${by.label},
        resolution_note = ${by.note ?? null}, reviewed_at = now()
      WHERE id = ${id} AND tenant_id = ${tenantId}
      RETURNING *
    `;
    return row ? mapFinding(row) : null;
  }

  // ── Approvals ────────────────────────────────────────────────────────────

  async insertApproval(input: Parameters<DecisionStore["insertApproval"]>[0]) {
    const inserted = await this.q`
      INSERT INTO approval_requests (
        tenant_id, kind, decision_id, related_decision_ids, conflict_id, payload, reason,
        requested_by_type, requested_by_label, agent_session_id, dedupe_key
      ) VALUES (
        ${input.tenantId}, ${input.kind}, ${input.decisionId}, ${j(input.relatedDecisionIds ?? [])}::jsonb,
        ${input.conflictId ?? null}, ${j(input.payload ?? null)}::jsonb, ${input.reason},
        ${input.requestedByType}, ${input.requestedByLabel ?? null}, ${input.agentSessionId ?? null},
        ${input.dedupeKey ?? null}
      )
      ON CONFLICT (tenant_id, dedupe_key) DO NOTHING
      RETURNING *
    `;
    if (inserted[0]) return { approval: mapApproval(inserted[0]), created: true };
    const [existing] = await this.q`
      SELECT * FROM approval_requests WHERE tenant_id = ${input.tenantId} AND dedupe_key = ${input.dedupeKey ?? null}
    `;
    return { approval: mapApproval(existing!), created: false };
  }

  async getApproval(tenantId: string, id: string) {
    const [row] = await this.q`SELECT * FROM approval_requests WHERE id = ${id} AND tenant_id = ${tenantId}`;
    return row ? mapApproval(row) : null;
  }

  async listApprovals(tenantId: string, opts: { status?: ApprovalStatus; decisionId?: string; limit?: number } = {}) {
    const rows = await this.q`
      SELECT * FROM approval_requests WHERE tenant_id = ${tenantId}
        ${opts.status ? this.q`AND status = ${opts.status}` : this.q``}
        ${opts.decisionId ? this.q`AND decision_id = ${opts.decisionId}` : this.q``}
      ORDER BY created_at DESC LIMIT ${opts.limit ?? 100}
    `;
    return rows.map(mapApproval);
  }

  async resolveApproval(
    tenantId: string,
    id: string,
    status: Exclude<ApprovalStatus, "PENDING">,
    by: { userId: string | null; label: string; note?: string | null },
  ) {
    // Only a PENDING request can be resolved; a second click is a no-op error
    // rather than a silent re-resolution.
    const [row] = await this.q`
      UPDATE approval_requests SET status = ${status}, resolved_by = ${by.userId},
        resolved_by_label = ${by.label}, resolution_note = ${by.note ?? null}, resolved_at = now()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND status IN ('PENDING', 'NEEDS_EVIDENCE')
      RETURNING *
    `;
    if (!row) throw new Error(`Approval ${id} is not pending in this workspace.`);
    return mapApproval(row);
  }

  // ── Dependencies ─────────────────────────────────────────────────────────

  async insertDependencies(tenantId: string, decisionId: string, deps: NewDependency[]) {
    for (const d of deps) {
      await this.q`
        INSERT INTO decision_dependencies (tenant_id, decision_id, target_type, target_id, target_key, relationship, importance)
        SELECT ${tenantId}, d.id, ${d.targetType}, ${d.targetId ?? null}, ${d.targetKey ?? null},
               ${d.relationship ?? "DEPENDS_ON"}, ${d.importance ?? 0.5}
        FROM decisions d WHERE d.id = ${decisionId} AND d.tenant_id = ${tenantId}
      `;
    }
  }

  async listDependencies(
    tenantId: string,
    opts: { decisionIds?: string[]; targetIds?: string[]; targetKeys?: string[] },
  ) {
    const empty = (a?: string[]) => !a || a.length === 0;
    if (empty(opts.decisionIds) && empty(opts.targetIds) && empty(opts.targetKeys)) return [];
    const rows = await this.q`
      SELECT * FROM decision_dependencies WHERE tenant_id = ${tenantId} AND (
        ${opts.decisionIds?.length ? this.q`decision_id IN ${this.q(opts.decisionIds)}` : this.q`false`}
        OR ${opts.targetIds?.length ? this.q`target_id IN ${this.q(opts.targetIds)}` : this.q`false`}
        OR ${opts.targetKeys?.length ? this.q`target_key IN ${this.q(opts.targetKeys)}` : this.q`false`}
      )
    `;
    return rows.map(mapDependency);
  }

  // ── Outcomes ─────────────────────────────────────────────────────────────

  async insertOutcome(input: Parameters<DecisionStore["insertOutcome"]>[0]) {
    const [row] = await this.q`
      INSERT INTO decision_outcomes (tenant_id, decision_id, summary, sentiment, recorded_by)
      SELECT ${input.tenantId}, d.id, ${input.summary}, ${input.sentiment}, ${input.recordedBy}
      FROM decisions d WHERE d.id = ${input.decisionId} AND d.tenant_id = ${input.tenantId}
      RETURNING id
    `;
    if (!row) throw new Error("Decision not found in this workspace.");
    return { id: row.id as string };
  }

  // ── Provenance trail ─────────────────────────────────────────────────────

  async recordMemoryEvent(input: Parameters<DecisionStore["recordMemoryEvent"]>[0]) {
    await this.q`
      INSERT INTO memory_events (
        tenant_id, project_id, entity_type, entity_id, decision_id, event_type, agent_run_id,
        actor_type, actor_user_id, summary, metadata, dedupe_key, created_at
      ) VALUES (
        ${input.tenantId}, ${input.projectId ?? null}, ${input.entityType}, ${input.entityId},
        ${input.decisionId ?? null}, ${input.eventType}, ${input.agentRunId ?? null}, ${input.actorType},
        ${input.actorUserId ?? null}, ${input.summary ?? null}, ${j(input.metadata ?? null)}::jsonb,
        ${input.dedupeKey ?? null},
        -- now() is the transaction start on both engines; events written in
        -- one transaction need their real order for the timeline.
        clock_timestamp()
      )
      ON CONFLICT (tenant_id, dedupe_key) DO NOTHING
    `;
  }

  async listMemoryEvents(tenantId: string, decisionId: string) {
    const rows = await this.q`
      SELECT * FROM memory_events WHERE tenant_id = ${tenantId} AND decision_id = ${decisionId}
      ORDER BY created_at ASC, id ASC
    `;
    return rows.map(mapMemoryEvent);
  }

  async recordAudit(input: Parameters<DecisionStore["recordAudit"]>[0]) {
    await this.q`
      INSERT INTO audit_events (tenant_id, actor_user_id, actor_label, action, entity_type, entity_id, metadata)
      VALUES (${input.tenantId}, ${input.actorUserId ?? null}, ${input.actorLabel ?? null}, ${input.action},
              ${input.entityType ?? null}, ${input.entityId ?? null}, ${j(input.metadata ?? null)}::jsonb)
    `;
  }

  async recordTrace(input: Parameters<DecisionStore["recordTrace"]>[0]) {
    const [row] = await this.q`
      INSERT INTO memory_traces (
        tenant_id, agent_run_id, action_type, related_decision_id, query_text, rendered_sql,
        candidates, used_chunk_ids, llm_reasoning, retrieval_latency_ms, scoring_weights
      ) VALUES (
        ${input.tenantId}, ${input.agentRunId}, ${input.actionType}, ${input.relatedDecisionId ?? null},
        ${input.queryText}, ${input.renderedSql}, ${j(input.candidates)}::jsonb,
        ${input.usedChunkIds}::uuid[], ${input.llmReasoning}, ${input.retrievalLatencyMs ?? null},
        ${j(input.scoringWeights ?? null)}::jsonb
      )
      RETURNING id
    `;
    return { id: row!.id as string };
  }

  async recordRetrievalEvents(input: Parameters<DecisionStore["recordRetrievalEvents"]>[0]) {
    for (const c of input.candidates) {
      await this.q`
        INSERT INTO retrieval_events (
          tenant_id, agent_run_id, memory_trace_id, memory_type, memory_id, memory_chunk_id,
          similarity_score, importance_score, authority_score, contextual_score, final_score,
          selected_for_context, cross_session
        ) VALUES (
          ${input.tenantId}, ${input.agentRunId}, ${input.memoryTraceId}, ${c.sourceType}, ${c.sourceId},
          ${c.chunkId}, ${c.semanticScore}, ${c.importanceScore}, ${c.authorityComponent},
          ${c.contextualScore}, ${c.finalScore}, ${c.selectedForContext}, ${c.crossSession}
        )
      `;
    }
  }

  // ── Agent sessions and runs ──────────────────────────────────────────────

  async upsertAgentSession(input: Parameters<DecisionStore["upsertAgentSession"]>[0]) {
    const [row] = await this.q`
      INSERT INTO agent_sessions (tenant_id, agent, external_session_id, repository, intent, api_key_id)
      VALUES (${input.tenantId}, ${input.agent}, ${input.externalSessionId}, ${input.repository ?? null},
              ${input.intent ?? null}, ${input.apiKeyId ?? null})
      ON CONFLICT (tenant_id, agent, external_session_id) DO UPDATE SET
        last_seen_at = now(),
        repository = COALESCE(EXCLUDED.repository, agent_sessions.repository),
        intent = COALESCE(EXCLUDED.intent, agent_sessions.intent)
      RETURNING *
    `;
    return mapSession(row!);
  }

  async endAgentSession(tenantId: string, id: string, outcome: string | null) {
    await this.q`
      UPDATE agent_sessions SET status = 'ENDED', ended_at = now(), outcome = ${outcome}
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
  }

  async getAgentSession(tenantId: string, id: string) {
    const [row] = await this.q`SELECT * FROM agent_sessions WHERE id = ${id} AND tenant_id = ${tenantId}`;
    return row ? mapSession(row) : null;
  }

  async listAgentSessions(tenantId: string, opts: { limit?: number } = {}) {
    const rows = await this.q`
      SELECT * FROM agent_sessions WHERE tenant_id = ${tenantId}
      ORDER BY last_seen_at DESC LIMIT ${opts.limit ?? 50}
    `;
    return rows.map(mapSession);
  }

  async startRun(input: {
    tenantId: string;
    sessionId: string;
    intent: AgentIntent;
    request: string | null;
    agentSessionId?: string | null;
    eventId?: string | null;
    createdBy?: string | null;
  }) {
    const [row] = await this.q`
      INSERT INTO agent_runs (tenant_id, session_id, intent, request, agent_session_id, event_id, created_by)
      VALUES (${input.tenantId}, ${input.sessionId}, ${input.intent}, ${input.request},
              ${input.agentSessionId ?? null}, ${input.eventId ?? null}, ${input.createdBy ?? null})
      RETURNING *
    `;
    return mapRun(row!);
  }

  async completeRun(tenantId: string, id: string, input: Parameters<DecisionStore["completeRun"]>[2]) {
    await this.q`
      UPDATE agent_runs SET
        status = ${input.status}, completed_at = now(), latency_ms = ${input.latencyMs},
        retrieval_latency_ms = ${input.retrievalLatencyMs ?? null},
        memories_retrieved = ${input.memoriesRetrieved ?? 0},
        memories_written = ${input.memoriesWritten ?? 0},
        conflicts_detected = ${input.conflictsDetected ?? 0},
        output_summary = ${input.outputSummary ?? null}, error = ${input.error ?? null},
        details = ${j(input.details ?? null)}::jsonb
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
  }

  async listRuns(tenantId: string, opts: { agentSessionId?: string; eventId?: string; limit?: number }) {
    const rows = await this.q`
      SELECT * FROM agent_runs WHERE tenant_id = ${tenantId}
        ${opts.agentSessionId ? this.q`AND agent_session_id = ${opts.agentSessionId}` : this.q``}
        ${opts.eventId ? this.q`AND event_id = ${opts.eventId}` : this.q``}
      ORDER BY started_at ASC LIMIT ${opts.limit ?? 200}
    `;
    return rows.map(mapRun);
  }

  // ── Durable jobs ─────────────────────────────────────────────────────────

  async enqueueJob(input: Parameters<DecisionStore["enqueueJob"]>[0]) {
    const inserted = await this.q`
      INSERT INTO jobs (tenant_id, kind, payload, dedupe_key, run_after, max_attempts)
      VALUES (${input.tenantId}, ${input.kind}, ${j(input.payload)}::jsonb, ${input.dedupeKey ?? null},
              ${input.runAfter ?? new Date()}, ${input.maxAttempts ?? 5})
      ON CONFLICT (kind, dedupe_key) DO NOTHING
      RETURNING *
    `;
    if (inserted[0]) return { job: mapJob(inserted[0]), created: true };
    const [existing] = await this.q`
      SELECT * FROM jobs WHERE kind = ${input.kind} AND dedupe_key = ${input.dedupeKey ?? null}
    `;
    return { job: mapJob(existing!), created: false };
  }

  async claimJobs(workerId: string, limit: number, opts: { kinds?: string[]; lockTimeoutMs?: number } = {}) {
    // A RUNNING job whose lock is older than the timeout belongs to a worker
    // that died; it becomes claimable again (its attempt still counts).
    const staleBefore = new Date(Date.now() - (opts.lockTimeoutMs ?? 5 * 60_000));
    const rows = await this.q`
      UPDATE jobs SET status = 'RUNNING', locked_by = ${workerId}, locked_at = now(),
        attempts = attempts + 1, updated_at = now()
      WHERE id IN (
        SELECT id FROM jobs
        WHERE ((status = 'QUEUED' AND run_after <= now()) OR (status = 'RUNNING' AND locked_at < ${staleBefore}))
          ${opts.kinds?.length ? this.q`AND kind IN ${this.q(opts.kinds)}` : this.q``}
        ORDER BY run_after
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `;
    return rows.map(mapJob);
  }

  async completeJob(id: string, result: Record<string, unknown> | null) {
    await this.q`
      UPDATE jobs SET status = 'SUCCEEDED', result = ${j(result)}::jsonb, completed_at = now(),
        updated_at = now(), locked_by = NULL, locked_at = NULL, last_error = NULL
      WHERE id = ${id}
    `;
  }

  async failJob(id: string, error: string, retryAt: Date | null): Promise<Job> {
    const [row] = await this.q`
      UPDATE jobs SET
        status = CASE WHEN ${retryAt === null} OR attempts >= max_attempts THEN 'DEAD' ELSE 'QUEUED' END,
        run_after = COALESCE(${retryAt}, run_after),
        last_error = ${error.slice(0, 4000)}, locked_by = NULL, locked_at = NULL, updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
    return mapJob(row!);
  }

  async getJob(id: string) {
    const [row] = await this.q`SELECT * FROM jobs WHERE id = ${id}`;
    return row ? mapJob(row) : null;
  }

  async listJobs(opts: { tenantId?: string | null; status?: Job["status"]; limit?: number }) {
    const rows = await this.q`
      SELECT * FROM jobs WHERE true
        ${opts.tenantId ? this.q`AND tenant_id = ${opts.tenantId}` : this.q``}
        ${opts.status ? this.q`AND status = ${opts.status}` : this.q``}
      ORDER BY created_at DESC LIMIT ${opts.limit ?? 100}
    `;
    return rows.map(mapJob);
  }

  // ── Configuration ────────────────────────────────────────────────────────

  async listWorkspacePolicies(tenantId: string): Promise<PolicyRule[]> {
    const rows = await this.q`
      SELECT definition FROM workspace_policies WHERE tenant_id = ${tenantId} AND enabled = true
    `;
    const rules: PolicyRule[] = [];
    for (const row of rows) {
      // A malformed stored policy is skipped, not half-applied.
      const parsed = policyRuleSchema.safeParse(json(row.definition, null));
      if (parsed.success) rules.push(parsed.data);
    }
    return rules;
  }

  async findRepositoryBinding(provider: string, repository: string) {
    const [row] = await this.q`
      SELECT * FROM repository_bindings WHERE provider = ${provider} AND lower(repository) = ${repository.toLowerCase()}
    `;
    return row ? mapBinding(row) : null;
  }

  async upsertRepositoryBinding(input: Parameters<DecisionStore["upsertRepositoryBinding"]>[0]) {
    const [row] = await this.q`
      INSERT INTO repository_bindings (tenant_id, provider, repository, project_id, installation_id, advisory_mode)
      VALUES (${input.tenantId}, ${input.provider}, ${input.repository.toLowerCase()}, ${input.projectId ?? null},
              ${input.installationId ?? null}, ${input.advisoryMode ?? true})
      ON CONFLICT (provider, repository) DO UPDATE SET
        installation_id = COALESCE(EXCLUDED.installation_id, repository_bindings.installation_id),
        project_id = COALESCE(EXCLUDED.project_id, repository_bindings.project_id)
      WHERE repository_bindings.tenant_id = EXCLUDED.tenant_id
      RETURNING *
    `;
    if (!row) throw new Error("Repository is already bound to a different workspace.");
    return mapBinding(row);
  }
}

export type { Scope };
