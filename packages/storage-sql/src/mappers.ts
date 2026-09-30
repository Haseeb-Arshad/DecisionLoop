import { OPERATORS, VALUE_TYPES } from "@decisionloop/core/assumptions/model";
import type {
  ExpectedValue,
  Operator,
  ValueType,
  VerificationPolicy,
} from "@decisionloop/core/assumptions/model";
import type {
  ActorType,
  Assumption,
  AssumptionOperator,
  AssumptionType,
  AssumptionValidity,
  ConstraintRule,
  Decision,
  DecisionConstraint,
  DecisionOption,
  DecisionOrigin,
  DecisionResource,
  DecisionVerificationCheck,
  DecisionStatus,
  MemoryIndexStatus,
} from "@decisionloop/core/types/domain";

/**
 * The single place SQL rows become domain objects, shared by the 1.x
 * repository layer (lib/repo/*) and the 2.0 SqlDecisionStore. Every 2.0
 * column is read with a fallback so these mappers also work against a
 * database that has not yet applied migration 0005.
 */

type Row = Record<string, unknown>;

const iso = (v: unknown): string | null => (v ? new Date(v as string | Date).toISOString() : null);
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown, fallback: number): number =>
  v === null || v === undefined ? fallback : Number(v);

function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function textArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.startsWith("{")) {
    // Postgres array literal fallback: {a,b}
    return v
      .slice(1, -1)
      .split(",")
      .map((s) => s.replace(/^"|"$/g, ""))
      .filter(Boolean);
  }
  return [];
}

export function mapDecision(row: Row): Decision {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    projectId: str(row.project_id),
    title: row.title as string,
    problemStatement: str(row.problem_statement),
    reasoning: str(row.reasoning),
    status: row.status as DecisionStatus,
    memoryIndexStatus: (row.memory_index_status as MemoryIndexStatus) ?? "PENDING",
    memoryIndexError: str(row.memory_index_error),
    confidence: num(row.confidence, 0.7),
    importance: num(row.importance, 0.6),
    riskExplanation: str(row.risk_explanation),
    supersededByDecisionId: str(row.superseded_by_decision_id),
    reopenedAt: iso(row.reopened_at),
    closedAt: iso(row.closed_at),
    createdBy: str(row.created_by),
    createdInSession: str(row.created_in_session),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    domain: (row.domain as string) ?? "general",
    scope: str(row.scope),
    origin: ((row.origin as DecisionOrigin) ?? "HUMAN"),
    decidedByType: ((row.decided_by_type as ActorType) ?? "USER"),
    decidedByLabel: str(row.decided_by_label),
    externalRef: str(row.external_ref),
    tags: textArray(row.tags),
    metadata: json<Record<string, unknown> | null>(row.metadata, null),
    verificationChecks: readVerificationChecks(json<Record<string, unknown> | null>(row.metadata, null)),
    sourceRefs: json(row.source_refs, [] as Decision["sourceRefs"]),
    validFrom: iso(row.valid_from),
    reviewedAt: iso(row.reviewed_at),
    agentSessionId: str(row.agent_session_id),
  };
}

function readVerificationChecks(metadata: Record<string, unknown> | null) {
  let value = metadata?.verificationChecks;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.name !== "string" || typeof item.repository !== "string") return [];
    const kind: DecisionVerificationCheck["kind"] = item.kind === "BENCHMARK" || item.kind === "RUNTIME" ? item.kind : "TEST";
    return [{ name: item.name, repository: item.repository.toLowerCase(), kind, description: typeof item.description === "string" ? item.description : null }];
  });
}

export function mapOption(row: Row): DecisionOption {
  return {
    id: row.id as string,
    decisionId: row.decision_id as string,
    name: row.name as string,
    description: str(row.description),
    isChosen: Boolean(row.is_chosen),
    rejectionReason: str(row.rejection_reason),
    createdAt: iso(row.created_at)!,
  };
}

const LEGACY_OPERATORS = new Set(["<", "<=", ">", ">=", "="]);

export function mapAssumption(row: Row): Assumption {
  const rawOperator = str(row.operator);
  const value = row.value === null || row.value === undefined ? null : Number(row.value);
  const metric = str(row.metric);
  const storedType = str(row.value_type);
  // Rows written before 0005 have no value_type: a complete numeric
  // constraint is a NUMBER assumption, anything else is qualitative.
  const valueType: ValueType =
    storedType && (VALUE_TYPES as readonly string[]).includes(storedType)
      ? (storedType as ValueType)
      : metric && rawOperator && value !== null
        ? "NUMBER"
        : "TEXT";
  const operatorV2 =
    rawOperator && (OPERATORS as readonly string[]).includes(rawOperator) ? (rawOperator as Operator) : null;
  const expected = json<ExpectedValue>(row.expected, null) ?? (valueType === "NUMBER" ? value : null);

  return {
    id: row.id as string,
    decisionId: row.decision_id as string,
    statement: row.statement as string,
    normalizedStatement: str(row.normalized_statement),
    assumptionType: ((row.assumption_type as AssumptionType) ?? "QUANTITATIVE"),
    metric,
    operator: rawOperator && LEGACY_OPERATORS.has(rawOperator) ? (rawOperator as AssumptionOperator) : null,
    value,
    unit: str(row.unit),
    validityStatus: row.validity_status as AssumptionValidity,
    importance: num(row.importance, 0.6),
    confidence: num(row.confidence, 0.7),
    authorityScore: num(row.authority_score, 0.7),
    validFrom: iso(row.valid_from) ?? iso(row.created_at)!,
    validUntil: iso(row.valid_until),
    invalidatedByEvidenceId: str(row.invalidated_by_evidence_id),
    challengedAt: iso(row.challenged_at),
    invalidatedAt: iso(row.invalidated_at),
    createdAt: iso(row.created_at)!,
    subject: str(row.subject),
    predicate: str(row.predicate) ?? metric,
    valueType,
    operatorV2,
    expected,
    verificationPolicy: ((row.verification_policy as VerificationPolicy) ?? "DETERMINISTIC_FIRST"),
    provenance: json<Record<string, unknown> | null>(row.provenance, null),
    lastEvaluatedAt: iso(row.last_evaluated_at),
  };
}

export function mapResource(row: Row): DecisionResource {
  return {
    id: row.id as string,
    decisionId: row.decision_id as string,
    resourceType: row.resource_type as string,
    resourceKey: row.resource_key as string,
    repository: str(row.repository),
    relationship: (row.relationship as string) ?? "AFFECTS",
    createdAt: iso(row.created_at)!,
  };
}

export function mapConstraint(row: Row): DecisionConstraint {
  return {
    id: row.id as string,
    decisionId: row.decision_id as string,
    statement: row.statement as string,
    rule: json<ConstraintRule>(row.rule, { kind: "manual" }),
    severity: ((row.severity as DecisionConstraint["severity"]) ?? "ADVISORY"),
    createdAt: iso(row.created_at)!,
  };
}
