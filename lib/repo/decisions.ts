import { sql } from "@/db/client";
import { assertTransition } from "@/lib/domain/decisionStatus";
import type {
  Assumption,
  AssumptionOperator,
  AssumptionType,
  AssumptionValidity,
  Decision,
  DecisionOption,
  DecisionStatus,
  DecisionWithDetails,
  MemoryIndexStatus,
} from "@/lib/types";

function mapDecision(row: Record<string, unknown>): Decision {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    projectId: (row.project_id as string) ?? null,
    title: row.title as string,
    problemStatement: (row.problem_statement as string) ?? null,
    reasoning: (row.reasoning as string) ?? null,
    status: row.status as DecisionStatus,
    memoryIndexStatus: (row.memory_index_status as MemoryIndexStatus) ?? "PENDING",
    memoryIndexError: (row.memory_index_error as string) ?? null,
    confidence: Number(row.confidence ?? 0.7),
    importance: Number(row.importance ?? 0.6),
    riskExplanation: (row.risk_explanation as string) ?? null,
    supersededByDecisionId: (row.superseded_by_decision_id as string) ?? null,
    reopenedAt: row.reopened_at ? (row.reopened_at as Date).toISOString() : null,
    closedAt: row.closed_at ? (row.closed_at as Date).toISOString() : null,
    createdBy: (row.created_by as string) ?? null,
    createdInSession: (row.created_in_session as string) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

function mapOption(row: Record<string, unknown>): DecisionOption {
  return {
    id: row.id as string,
    decisionId: row.decision_id as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    isChosen: row.is_chosen as boolean,
    rejectionReason: (row.rejection_reason as string) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function mapAssumption(row: Record<string, unknown>): Assumption {
  return {
    id: row.id as string,
    decisionId: row.decision_id as string,
    statement: row.statement as string,
    normalizedStatement: (row.normalized_statement as string) ?? null,
    assumptionType: (row.assumption_type as AssumptionType) ?? "QUANTITATIVE",
    metric: (row.metric as string) ?? null,
    operator: (row.operator as AssumptionOperator) ?? null,
    value: row.value === null ? null : Number(row.value),
    unit: (row.unit as string) ?? null,
    validityStatus: row.validity_status as AssumptionValidity,
    importance: Number(row.importance ?? 0.6),
    confidence: Number(row.confidence ?? 0.7),
    authorityScore: Number(row.authority_score ?? 0.7),
    validFrom: (row.valid_from as Date).toISOString(),
    validUntil: row.valid_until ? (row.valid_until as Date).toISOString() : null,
    invalidatedByEvidenceId: (row.invalidated_by_evidence_id as string) ?? null,
    challengedAt: row.challenged_at ? (row.challenged_at as Date).toISOString() : null,
    invalidatedAt: row.invalidated_at ? (row.invalidated_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

/**
 * Canonical machine-comparable form of an assumption, e.g.
 * `annual_price < 25000 usd/year`. Stored so two assumptions about the same
 * metric can be matched without a model call, and so the deterministic
 * conflict check has a stable key to compare against (§10).
 */
export function normalizeAssumption(input: {
  metric?: string | null;
  operator?: AssumptionOperator | null;
  value?: number | null;
  unit?: string | null;
}): string | null {
  if (!input.metric || !input.operator || input.value === null || input.value === undefined) {
    return null;
  }
  const metric = input.metric.trim().toLowerCase().replace(/\s+/g, "_");
  const unit = (input.unit ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return `${metric} ${input.operator} ${input.value}${unit ? ` ${unit}` : ""}`;
}

export interface NewDecisionInput {
  tenantId: string;
  projectId?: string | null;
  title: string;
  problemStatement?: string | null;
  reasoning?: string | null;
  status?: DecisionStatus;
  confidence?: number;
  importance?: number;
  createdBy?: string | null;
  createdInSession?: string | null;
  commitKey?: string | null;
  commitFingerprint?: string | null;
  options: Array<{
    name: string;
    description?: string | null;
    isChosen: boolean;
    rejectionReason?: string | null;
  }>;
  assumptions: Array<{
    statement: string;
    assumptionType?: AssumptionType;
    metric?: string | null;
    operator?: AssumptionOperator | null;
    value?: number | null;
    unit?: string | null;
    importance?: number;
    confidence?: number;
    authorityScore?: number;
  }>;
}

/**
 * Commits a decision: the decision row, every option considered, and every
 * structured assumption it depends on, in one transaction. This is the
 * "Commit Decision" workflow's write path (§18) — nothing enters
 * authoritative organizational memory without an explicit call to this.
 */
export async function createDecision(
  input: NewDecisionInput,
): Promise<DecisionWithDetails> {
  return sql.begin(async (tx) => {
    if (input.projectId) {
      const [project] = await tx`
        SELECT id FROM projects WHERE id = ${input.projectId} AND tenant_id = ${input.tenantId}
      `;
      if (!project) throw new Error("Project not found in this workspace.");
    }

    if (input.createdBy) {
      const [user] = await tx`
        SELECT id FROM users WHERE id = ${input.createdBy} AND tenant_id = ${input.tenantId}
      `;
      if (!user) throw new Error("User not found in this workspace.");
    }

    const [decisionRow] = await tx`
      INSERT INTO decisions (
        tenant_id, project_id, title, problem_statement, reasoning, status,
        confidence, importance, created_by, created_in_session, commit_key, commit_fingerprint
      ) VALUES (
        ${input.tenantId}, ${input.projectId ?? null}, ${input.title},
        ${input.problemStatement ?? null}, ${input.reasoning ?? null},
        ${input.status ?? "ACTIVE"}, ${input.confidence ?? 0.7},
        ${input.importance ?? 0.6}, ${input.createdBy ?? null},
        ${input.createdInSession ?? null}, ${input.commitKey ?? null},
        ${input.commitFingerprint ?? null}
      )
      RETURNING *
    `;
    const decision = mapDecision(decisionRow!);

    const options: DecisionOption[] = [];
    for (const opt of input.options) {
      const [row] = await tx`
        INSERT INTO decision_options (
          decision_id, name, description, is_chosen, rejection_reason
        ) VALUES (
          ${decision.id}, ${opt.name}, ${opt.description ?? null},
          ${opt.isChosen}, ${opt.rejectionReason ?? null}
        )
        RETURNING *
      `;
      options.push(mapOption(row!));
    }

    const assumptions: Assumption[] = [];
    for (const a of input.assumptions) {
      const [row] = await tx`
        INSERT INTO assumptions (
          decision_id, statement, normalized_statement, assumption_type,
          metric, operator, value, unit, importance, confidence, authority_score
        ) VALUES (
          ${decision.id}, ${a.statement}, ${normalizeAssumption(a)},
          ${a.assumptionType ?? "QUANTITATIVE"}, ${a.metric ?? null},
          ${a.operator ?? null}, ${a.value ?? null}, ${a.unit ?? null},
          ${a.importance ?? 0.6}, ${a.confidence ?? 0.7}, ${a.authorityScore ?? 0.7}
        )
        RETURNING *
      `;
      assumptions.push(mapAssumption(row!));
    }

    return { ...decision, options, assumptions };
  });
}

export async function findDecisionByCommitKey(
  tenantId: string,
  commitKey: string,
): Promise<{ decision: DecisionWithDetails; fingerprint: string | null } | null> {
  const [row] = await sql`
    SELECT id, commit_fingerprint
    FROM decisions
    WHERE tenant_id = ${tenantId} AND commit_key = ${commitKey}
  `;
  if (!row) return null;
  const decision = await getDecisionById(tenantId, row.id as string);
  return decision
    ? { decision, fingerprint: (row.commit_fingerprint as string) ?? null }
    : null;
}

export async function setDecisionMemoryIndexStatus(
  tenantId: string,
  decisionId: string,
  status: MemoryIndexStatus,
  error?: string | null,
): Promise<Decision | null> {
  const [row] = await sql`
    UPDATE decisions
    SET memory_index_status = ${status},
        memory_index_error = ${error ?? null},
        memory_indexed_at = CASE WHEN ${status} = 'INDEXED' THEN now() ELSE memory_indexed_at END,
        updated_at = now()
    WHERE id = ${decisionId} AND tenant_id = ${tenantId}
    RETURNING *
  `;
  return row ? mapDecision(row) : null;
}

export async function getDecisionCommitKey(
  tenantId: string,
  decisionId: string,
): Promise<string | null> {
  const [row] = await sql`
    SELECT commit_key FROM decisions
    WHERE id = ${decisionId} AND tenant_id = ${tenantId}
  `;
  return row ? ((row.commit_key as string) ?? null) : null;
}

export async function getDecisionById(
  tenantId: string,
  decisionId: string,
): Promise<DecisionWithDetails | null> {
  const [decisionRow] = await sql`
    SELECT * FROM decisions WHERE id = ${decisionId} AND tenant_id = ${tenantId}
  `;
  if (!decisionRow) return null;

  const optionRows = await sql`
    SELECT * FROM decision_options WHERE decision_id = ${decisionId} ORDER BY created_at
  `;
  const assumptionRows = await sql`
    SELECT * FROM assumptions WHERE decision_id = ${decisionId} ORDER BY created_at
  `;

  return {
    ...mapDecision(decisionRow),
    options: optionRows.map(mapOption),
    assumptions: assumptionRows.map(mapAssumption),
  };
}

export async function listDecisions(
  tenantId: string,
  opts: { status?: DecisionStatus; projectId?: string } = {},
): Promise<DecisionWithDetails[]> {
  // At-risk decisions sort to the top — the dashboard and decisions list both
  // lead with "what needs attention", per §37.
  const decisionRows = await sql`
    SELECT * FROM decisions
    WHERE tenant_id = ${tenantId}
      ${opts.status ? sql`AND status = ${opts.status}` : sql``}
      ${opts.projectId ? sql`AND project_id = ${opts.projectId}` : sql``}
    ORDER BY
      CASE status WHEN 'AT_RISK' THEN 0 WHEN 'REOPENED' THEN 1 ELSE 2 END,
      updated_at DESC
  `;

  if (decisionRows.length === 0) return [];

  const ids = decisionRows.map((r) => r.id as string);
  const optionRows = await sql`
    SELECT * FROM decision_options WHERE decision_id IN ${sql(ids)} ORDER BY created_at
  `;
  const assumptionRows = await sql`
    SELECT * FROM assumptions WHERE decision_id IN ${sql(ids)} ORDER BY created_at
  `;

  return decisionRows.map((d) => {
    const decision = mapDecision(d);
    return {
      ...decision,
      options: optionRows.filter((o) => o.decision_id === decision.id).map(mapOption),
      assumptions: assumptionRows
        .filter((a) => a.decision_id === decision.id)
        .map(mapAssumption),
    };
  });
}

/**
 * Moves a decision to a new status, refusing illegal transitions
 * (lib/domain/decisionStatus.ts). Every status change in the app goes
 * through here, so business history can't be corrupted by a stray update
 * that skips the lifecycle rules.
 */
export async function updateDecisionStatus(
  tenantId: string,
  decisionId: string,
  status: DecisionStatus,
  opts: { riskExplanation?: string | null; supersededByDecisionId?: string | null } = {},
): Promise<Decision> {
  const [current] = await sql`
    SELECT status FROM decisions WHERE id = ${decisionId} AND tenant_id = ${tenantId}
  `;
  if (!current) throw new Error(`Decision ${decisionId} not found in tenant ${tenantId}.`);

  assertTransition(current.status as DecisionStatus, status);

  const [row] = await sql`
    UPDATE decisions SET
      status = ${status},
      risk_explanation = ${opts.riskExplanation ?? null},
      superseded_by_decision_id = COALESCE(${opts.supersededByDecisionId ?? null}, superseded_by_decision_id),
      reopened_at = CASE WHEN ${status} = 'REOPENED' THEN now() ELSE reopened_at END,
      closed_at = CASE WHEN ${status} IN ('SUPERSEDED', 'ARCHIVED') THEN now() ELSE closed_at END,
      updated_at = now()
    WHERE id = ${decisionId} AND tenant_id = ${tenantId}
    RETURNING *
  `;
  return mapDecision(row!);
}

export async function setAssumptionValidity(
  tenantId: string,
  assumptionId: string,
  validity: AssumptionValidity,
  opts: { invalidatedByEvidenceId?: string | null } = {},
): Promise<void> {
  await sql`
    UPDATE assumptions SET
      validity_status = ${validity},
      challenged_at = CASE WHEN ${validity} = 'CHALLENGED' THEN now() ELSE challenged_at END,
      invalidated_at = CASE WHEN ${validity} = 'INVALIDATED' THEN now() ELSE invalidated_at END,
      invalidated_by_evidence_id = COALESCE(${opts.invalidatedByEvidenceId ?? null}, invalidated_by_evidence_id)
    WHERE id = ${assumptionId}
      AND EXISTS (
        SELECT 1 FROM decisions d
        WHERE d.id = assumptions.decision_id AND d.tenant_id = ${tenantId}
      )
  `;
}

/**
 * Every still-live assumption across a tenant, with enough decision context
 * to report a conflict. Used by the conflict-detection pass, which fans out
 * across ALL decisions rather than being told which one a new document
 * relates to (see lib/engine/conflictDetection.ts).
 *
 * CHALLENGED assumptions are included deliberately: a second, more
 * authoritative document should be able to escalate a challenge into a full
 * invalidation, rather than being ignored because something weaker already
 * flagged it.
 */
export async function listOpenAssumptionsForTenant(
  tenantId: string,
): Promise<Array<Assumption & { decisionTitle: string; decisionStatus: DecisionStatus }>> {
  const rows = await sql`
    SELECT a.*, d.title AS decision_title, d.status AS decision_status
    FROM assumptions a
    JOIN decisions d ON d.id = a.decision_id
    WHERE d.tenant_id = ${tenantId}
      AND a.validity_status IN ('VALID', 'UNCERTAIN', 'CHALLENGED')
      AND d.status NOT IN ('ARCHIVED', 'SUPERSEDED')
  `;
  return rows.map((row) => ({
    ...mapAssumption(row),
    decisionTitle: row.decision_title as string,
    decisionStatus: row.decision_status as DecisionStatus,
  }));
}

export async function getAssumptionById(
  tenantId: string,
  assumptionId: string,
): Promise<Assumption | null> {
  const [row] = await sql`
    SELECT a.*
    FROM assumptions a
    JOIN decisions d ON d.id = a.decision_id
    WHERE a.id = ${assumptionId} AND d.tenant_id = ${tenantId}
  `;
  return row ? mapAssumption(row) : null;
}

export async function getDecisionOptions(decisionId: string): Promise<DecisionOption[]> {
  const rows = await sql`
    SELECT * FROM decision_options WHERE decision_id = ${decisionId} ORDER BY created_at
  `;
  return rows.map(mapOption);
}
