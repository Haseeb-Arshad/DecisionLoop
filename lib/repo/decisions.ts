import { sql } from "@/db/client";
import type {
  Assumption,
  AssumptionOperator,
  AssumptionStatus,
  Decision,
  DecisionOption,
  DecisionStatus,
  DecisionWithDetails,
} from "@/lib/types";

function mapDecision(row: Record<string, unknown>): Decision {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    title: row.title as string,
    problemStatement: (row.problem_statement as string) ?? null,
    reasoning: (row.reasoning as string) ?? null,
    status: row.status as DecisionStatus,
    riskExplanation: (row.risk_explanation as string) ?? null,
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
    metric: (row.metric as string) ?? null,
    operator: (row.operator as AssumptionOperator) ?? null,
    value: row.value === null ? null : Number(row.value),
    unit: (row.unit as string) ?? null,
    status: row.status as AssumptionStatus,
    createdAt: (row.created_at as Date).toISOString(),
    invalidatedAt: row.invalidated_at
      ? (row.invalidated_at as Date).toISOString()
      : null,
  };
}

export interface NewDecisionInput {
  tenantId: string;
  title: string;
  problemStatement?: string | null;
  reasoning?: string | null;
  createdBy?: string | null;
  createdInSession?: string | null;
  options: Array<{
    name: string;
    description?: string | null;
    isChosen: boolean;
    rejectionReason?: string | null;
  }>;
  assumptions: Array<{
    statement: string;
    metric?: string | null;
    operator?: AssumptionOperator | null;
    value?: number | null;
    unit?: string | null;
  }>;
}

/**
 * Commits a decision: the decision row, every option considered, and every
 * structured assumption it depends on, in one transaction. This is the
 * "Commit Decision" workflow's write path — see lib/ai/extraction.ts for how
 * the (title, options, assumptions) shape is produced from a conversation or
 * document before it reaches here.
 */
export async function createDecision(
  input: NewDecisionInput,
): Promise<DecisionWithDetails> {
  return sql.begin(async (tx) => {
    const [decisionRow] = await tx`
      INSERT INTO decisions (
        tenant_id, title, problem_statement, reasoning, created_by, created_in_session
      ) VALUES (
        ${input.tenantId},
        ${input.title},
        ${input.problemStatement ?? null},
        ${input.reasoning ?? null},
        ${input.createdBy ?? null},
        ${input.createdInSession ?? null}
      )
      RETURNING *
    `;
    const decision = mapDecision(decisionRow);

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
      options.push(mapOption(row));
    }

    const assumptions: Assumption[] = [];
    for (const a of input.assumptions) {
      const [row] = await tx`
        INSERT INTO assumptions (
          decision_id, statement, metric, operator, value, unit
        ) VALUES (
          ${decision.id}, ${a.statement}, ${a.metric ?? null},
          ${a.operator ?? null}, ${a.value ?? null}, ${a.unit ?? null}
        )
        RETURNING *
      `;
      assumptions.push(mapAssumption(row));
    }

    return { ...decision, options, assumptions };
  });
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
  opts: { status?: DecisionStatus } = {},
): Promise<DecisionWithDetails[]> {
  const decisionRows = opts.status
    ? await sql`
        SELECT * FROM decisions
        WHERE tenant_id = ${tenantId} AND status = ${opts.status}
        ORDER BY updated_at DESC
      `
    : await sql`
        SELECT * FROM decisions WHERE tenant_id = ${tenantId} ORDER BY updated_at DESC
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

export async function updateDecisionStatus(
  tenantId: string,
  decisionId: string,
  status: DecisionStatus,
  riskExplanation?: string | null,
): Promise<void> {
  await sql`
    UPDATE decisions
    SET status = ${status},
        risk_explanation = ${riskExplanation ?? null},
        updated_at = now()
    WHERE id = ${decisionId} AND tenant_id = ${tenantId}
  `;
}

export async function invalidateAssumption(assumptionId: string): Promise<void> {
  await sql`
    UPDATE assumptions
    SET status = 'INVALIDATED', invalidated_at = now()
    WHERE id = ${assumptionId}
  `;
}

/**
 * Every VALID assumption across a tenant, with enough decision context to
 * report a conflict — used by the conflict-detection pass, which fans out
 * across ALL decisions rather than being told which one a new document
 * relates to (see lib/ai/conflict.ts).
 */
export async function listValidAssumptionsForTenant(
  tenantId: string,
): Promise<Array<Assumption & { decisionTitle: string; decisionStatus: DecisionStatus }>> {
  const rows = await sql`
    SELECT a.*, d.title AS decision_title, d.status AS decision_status
    FROM assumptions a
    JOIN decisions d ON d.id = a.decision_id
    WHERE d.tenant_id = ${tenantId} AND a.status = 'VALID' AND d.status != 'ARCHIVED'
  `;
  return rows.map((row) => ({
    ...mapAssumption(row),
    decisionTitle: row.decision_title as string,
    decisionStatus: row.decision_status as DecisionStatus,
  }));
}

export async function getAssumptionById(
  assumptionId: string,
): Promise<Assumption | null> {
  const [row] = await sql`SELECT * FROM assumptions WHERE id = ${assumptionId}`;
  return row ? mapAssumption(row) : null;
}
