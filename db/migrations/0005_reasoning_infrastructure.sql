-- DecisionLoop 2.0: persistent reasoning infrastructure.
-- See docs/v2/00-audit-and-plan.md §6.
--
-- Additive only: no existing column is dropped or retyped and no existing
-- row is rewritten except the provenance backfill at the end. Written in
-- portable SQL (TEXT, not STRING) so it applies unchanged on CockroachDB and
-- on PostgreSQL + pgvector. Array columns have no DEFAULT (the cast syntax
-- for an empty array literal differs between the two); readers treat NULL
-- as empty.

-- ── Universal decision object (spec §3) ─────────────────────────────────────
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT 'general';
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS scope TEXT;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'HUMAN';
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS decided_by_type TEXT NOT NULL DEFAULT 'USER';
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS decided_by_label TEXT;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS external_ref TEXT;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS tags TEXT[];
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS source_refs JSONB;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS agent_session_id UUID;

ALTER TABLE decisions ADD CONSTRAINT decisions_origin_check
  CHECK (origin IN ('HUMAN', 'AGENT', 'IMPORT', 'INTEGRATION'));
ALTER TABLE decisions ADD CONSTRAINT decisions_decided_by_type_check
  CHECK (decided_by_type IN ('USER', 'AGENT', 'SYSTEM'));

CREATE INDEX IF NOT EXISTS decisions_external_ref_idx ON decisions (tenant_id, external_ref);
CREATE INDEX IF NOT EXISTS decisions_domain_idx ON decisions (tenant_id, domain, status);

-- ── Affected resources ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS decision_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  decision_id UUID NOT NULL REFERENCES decisions (id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  repository TEXT,
  relationship TEXT NOT NULL DEFAULT 'AFFECTS',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS decision_resources_lookup_idx
  ON decision_resources (tenant_id, resource_type, resource_key);
CREATE INDEX IF NOT EXISTS decision_resources_decision_idx ON decision_resources (decision_id);
CREATE UNIQUE INDEX IF NOT EXISTS decision_resources_unique_idx
  ON decision_resources (decision_id, resource_type, resource_key, relationship);

-- ── Constraints a decision imposes on future work ───────────────────────────
CREATE TABLE IF NOT EXISTS decision_constraints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  decision_id UUID NOT NULL REFERENCES decisions (id) ON DELETE CASCADE,
  statement TEXT NOT NULL,
  rule JSONB NOT NULL,
  severity TEXT NOT NULL DEFAULT 'ADVISORY',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT decision_constraints_severity_check CHECK (severity IN ('ADVISORY', 'BLOCKING'))
);

CREATE INDEX IF NOT EXISTS decision_constraints_decision_idx ON decision_constraints (tenant_id, decision_id);

-- ── Generalized assumptions (docs/v2 §8) ────────────────────────────────────
-- The existing `operator` column (unconstrained text) now also carries the
-- generalized operators (!=, IN, NOT_IN, CONTAINS, NOT_CONTAINS).
ALTER TABLE assumptions ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE assumptions ADD COLUMN IF NOT EXISTS predicate TEXT;
ALTER TABLE assumptions ADD COLUMN IF NOT EXISTS value_type TEXT;
ALTER TABLE assumptions ADD COLUMN IF NOT EXISTS expected JSONB;
ALTER TABLE assumptions ADD COLUMN IF NOT EXISTS verification_policy TEXT NOT NULL DEFAULT 'DETERMINISTIC_FIRST';
ALTER TABLE assumptions ADD COLUMN IF NOT EXISTS provenance JSONB;
ALTER TABLE assumptions ADD COLUMN IF NOT EXISTS last_evaluated_at TIMESTAMPTZ;

ALTER TABLE assumptions ADD CONSTRAINT assumptions_value_type_check
  CHECK (value_type IS NULL OR value_type IN ('NUMBER', 'BOOLEAN', 'CATEGORY', 'DATE', 'VERSION', 'SET', 'TEXT'));
ALTER TABLE assumptions ADD CONSTRAINT assumptions_verification_policy_check
  CHECK (verification_policy IN ('DETERMINISTIC_FIRST', 'SEMANTIC_ONLY', 'MANUAL'));

CREATE INDEX IF NOT EXISTS assumptions_predicate_idx ON assumptions (predicate, subject);

-- ── Canonical event inbox (docs/v2 §7) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor JSONB NOT NULL,
  resources JSONB,
  facts JSONB,
  body_text TEXT,
  subject TEXT,
  evidence_kind TEXT NOT NULL DEFAULT 'OBSERVATION',
  payload JSONB,
  provenance JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  attempts INT8 NOT NULL DEFAULT 0,
  last_error TEXT,
  processed_at TIMESTAMPTZ,
  result JSONB,
  CONSTRAINT event_inbox_status_check
    CHECK (status IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED'))
);

-- Webhook retries collapse onto one row.
CREATE UNIQUE INDEX IF NOT EXISTS event_inbox_idempotency_idx
  ON event_inbox (tenant_id, source, external_id);
CREATE INDEX IF NOT EXISTS event_inbox_tenant_idx ON event_inbox (tenant_id, received_at DESC);
CREATE INDEX IF NOT EXISTS event_inbox_status_idx ON event_inbox (status, received_at);

-- ── Immutable evidence (spec §20) ───────────────────────────────────────────
-- Insert-only. Corrections are new rows pointing at what they supersede.
CREATE TABLE IF NOT EXISTS evidence_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects (id) ON DELETE CASCADE,
  event_id UUID REFERENCES event_inbox (id) ON DELETE SET NULL,
  document_id UUID REFERENCES documents (id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  source_ref TEXT,
  subject TEXT,
  authority FLOAT8 NOT NULL,
  confidence FLOAT8 NOT NULL DEFAULT 1,
  occurred_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  content TEXT,
  content_hash TEXT NOT NULL,
  facts JSONB NOT NULL,
  resources JSONB,
  provenance JSONB NOT NULL,
  actor JSONB NOT NULL,
  supersedes_evidence_id UUID REFERENCES evidence_items (id),
  CONSTRAINT evidence_items_kind_check CHECK (kind IN (
    'OBSERVATION', 'DOCUMENT', 'METRIC', 'CODE_DIFF', 'TEST_RESULT',
    'DEPLOYMENT_RESULT', 'HUMAN_STATEMENT', 'OFFICIAL_SOURCE', 'EXTERNAL_REPORT'))
);

CREATE UNIQUE INDEX IF NOT EXISTS evidence_items_idempotency_idx
  ON evidence_items (tenant_id, source, content_hash);
CREATE INDEX IF NOT EXISTS evidence_items_tenant_idx ON evidence_items (tenant_id, ingested_at DESC);
CREATE INDEX IF NOT EXISTS evidence_items_event_idx ON evidence_items (event_id);

-- ── Durable jobs (spec §18) ─────────────────────────────────────────────────
-- DEAD is the dead-letter state: attempts exhausted, error kept, visible in
-- the control plane, never silently dropped.
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  attempts INT8 NOT NULL DEFAULT 0,
  max_attempts INT8 NOT NULL DEFAULT 5,
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  dedupe_key TEXT,
  last_error TEXT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT jobs_status_check CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD'))
);

CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs (status, run_after);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe_idx ON jobs (kind, dedupe_key);
CREATE INDEX IF NOT EXISTS jobs_tenant_idx ON jobs (tenant_id, created_at DESC);

-- ── Agent sessions (external coding agents) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  external_session_id TEXT NOT NULL,
  repository TEXT,
  intent TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  api_key_id UUID,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  outcome TEXT,
  metadata JSONB,
  CONSTRAINT agent_sessions_status_check CHECK (status IN ('ACTIVE', 'ENDED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_sessions_external_idx
  ON agent_sessions (tenant_id, agent, external_session_id);
CREATE INDEX IF NOT EXISTS agent_sessions_tenant_idx ON agent_sessions (tenant_id, started_at DESC);

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS agent_session_id UUID REFERENCES agent_sessions (id) ON DELETE SET NULL;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES event_inbox (id) ON DELETE SET NULL;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS details JSONB;

ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_intent_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_intent_check CHECK (intent IN (
  'CONTEXT_REQUEST', 'TRIGGER_EVALUATION', 'PROPOSAL', 'POSTFLIGHT_REVIEW',
  'EXTRACT_DECISION', 'INGEST_EVIDENCE', 'CONFLICT_CHECK', 'ANSWER_QUESTION',
  'MEMORY_ANALYSIS', 'UNKNOWN'));

CREATE INDEX IF NOT EXISTS agent_runs_agent_session_idx ON agent_runs (agent_session_id, started_at);

-- ── Per-assumption evaluation records: the trigger engine's provenance ──────
-- Written in the same transaction as any state change it causes, so a
-- transition never exists without the record of why (docs/v2 §4.2).
CREATE TABLE IF NOT EXISTS assumption_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  agent_run_id UUID REFERENCES agent_runs (id) ON DELETE SET NULL,
  event_id UUID REFERENCES event_inbox (id) ON DELETE SET NULL,
  evidence_item_id UUID REFERENCES evidence_items (id) ON DELETE CASCADE,
  assumption_id UUID NOT NULL REFERENCES assumptions (id) ON DELETE CASCADE,
  decision_id UUID NOT NULL REFERENCES decisions (id) ON DELETE CASCADE,
  fact JSONB,
  method TEXT NOT NULL,
  relation TEXT NOT NULL,
  confidence FLOAT8 NOT NULL,
  evidence_authority FLOAT8 NOT NULL,
  assumption_authority FLOAT8 NOT NULL,
  previous_validity TEXT NOT NULL,
  next_validity TEXT,
  decision_flagged BOOL NOT NULL DEFAULT false,
  matched_policies JSONB,
  actions JSONB,
  explanation TEXT NOT NULL,
  retrieval_score FLOAT8,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assumption_evaluations_method_check
    CHECK (method IN ('DETERMINISTIC', 'SEMANTIC', 'UNAVAILABLE', 'SKIPPED'))
);

CREATE INDEX IF NOT EXISTS assumption_evaluations_assumption_idx
  ON assumption_evaluations (assumption_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assumption_evaluations_event_idx ON assumption_evaluations (event_id);
CREATE INDEX IF NOT EXISTS assumption_evaluations_tenant_idx
  ON assumption_evaluations (tenant_id, created_at DESC);

-- ── Conflicts: link to evidence items and events; idempotent per evidence ───
ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS evidence_item_id UUID REFERENCES evidence_items (id) ON DELETE SET NULL;
ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES event_inbox (id) ON DELETE SET NULL;
ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS evaluation_id UUID REFERENCES assumption_evaluations (id) ON DELETE SET NULL;
ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS resolution_note TEXT;
ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS resolved_by_label TEXT;

-- NULL evidence_item_id (every 1.x row) never collides.
CREATE UNIQUE INDEX IF NOT EXISTS conflict_events_evidence_idempotency_idx
  ON conflict_events (tenant_id, assumption_id, evidence_item_id);

ALTER TABLE decision_evidence ADD COLUMN IF NOT EXISTS evidence_item_id UUID REFERENCES evidence_items (id) ON DELETE CASCADE;

-- ── Constraint findings (advisory PR checks, spec §11) ──────────────────────
CREATE TABLE IF NOT EXISTS constraint_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  decision_id UUID NOT NULL REFERENCES decisions (id) ON DELETE CASCADE,
  constraint_id UUID NOT NULL REFERENCES decision_constraints (id) ON DELETE CASCADE,
  event_id UUID REFERENCES event_inbox (id) ON DELETE SET NULL,
  evidence_item_id UUID REFERENCES evidence_items (id) ON DELETE SET NULL,
  explanation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  resolution_note TEXT,
  resolved_by_label TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT constraint_findings_status_check
    CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'FALSE_POSITIVE', 'ACCEPTED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS constraint_findings_idempotency_idx
  ON constraint_findings (tenant_id, constraint_id, event_id);
CREATE INDEX IF NOT EXISTS constraint_findings_tenant_idx ON constraint_findings (tenant_id, created_at DESC);

-- ── Approvals (spec §25) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  decision_id UUID REFERENCES decisions (id) ON DELETE CASCADE,
  related_decision_ids JSONB,
  conflict_id UUID REFERENCES conflict_events (id) ON DELETE CASCADE,
  payload JSONB,
  reason TEXT NOT NULL,
  requested_by_type TEXT NOT NULL,
  requested_by_label TEXT,
  agent_session_id UUID REFERENCES agent_sessions (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  resolved_by UUID REFERENCES users (id),
  resolved_by_label TEXT,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  dedupe_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT approval_requests_kind_check CHECK (kind IN (
    'COMMIT_DECISION', 'ADD_ASSUMPTION', 'REVIEW_CONFLICT', 'SUPERSEDE_DECISION')),
  CONSTRAINT approval_requests_status_check CHECK (status IN (
    'PENDING', 'APPROVED', 'REJECTED', 'NEEDS_EVIDENCE', 'LINKED', 'SUPERSEDED_OLD'))
);

CREATE INDEX IF NOT EXISTS approval_requests_tenant_idx ON approval_requests (tenant_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_dedupe_idx ON approval_requests (tenant_id, dedupe_key);

-- ── Decision dependencies (spec §21) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS decision_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  decision_id UUID NOT NULL REFERENCES decisions (id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id UUID,
  target_key TEXT,
  relationship TEXT NOT NULL DEFAULT 'DEPENDS_ON',
  importance FLOAT8 NOT NULL DEFAULT 0.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT decision_dependencies_target_check CHECK (target_type IN (
    'ASSUMPTION', 'DECISION', 'RESOURCE', 'POLICY', 'METRIC', 'VENDOR', 'PACKAGE', 'SERVICE')),
  CONSTRAINT decision_dependencies_ref_check CHECK (target_id IS NOT NULL OR target_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS decision_dependencies_decision_idx ON decision_dependencies (tenant_id, decision_id);
CREATE INDEX IF NOT EXISTS decision_dependencies_target_idx
  ON decision_dependencies (tenant_id, target_type, target_id);

-- ── Machine credentials for MCP / SDK / CLI / hooks ─────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes TEXT[] NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'agent',
  created_by UUID REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT api_keys_actor_type_check CHECK (actor_type IN ('user', 'agent', 'integration'))
);

CREATE UNIQUE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS api_keys_tenant_idx ON api_keys (tenant_id);

-- ── Repository → workspace routing for integrations ─────────────────────────
CREATE TABLE IF NOT EXISTS repository_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects (id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  repository TEXT NOT NULL,
  installation_id TEXT,
  advisory_mode BOOL NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS repository_bindings_repo_idx ON repository_bindings (provider, repository);

-- ── Workspace policy overrides (defaults ship in code) ──────────────────────
CREATE TABLE IF NOT EXISTS workspace_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  definition JSONB NOT NULL,
  enabled BOOL NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_policies_name_idx ON workspace_policies (tenant_id, scope, name);

-- ── Cross-session provenance on memory (docs/v2 §4.1) ───────────────────────
ALTER TABLE memory_chunks ADD COLUMN IF NOT EXISTS origin_session_id TEXT;

UPDATE memory_chunks SET origin_session_id = (
  SELECT d.created_in_session FROM decisions d WHERE d.id = memory_chunks.decision_id
)
WHERE origin_session_id IS NULL
  AND decision_id IS NOT NULL
  AND source_type IN ('decision', 'assumption');
