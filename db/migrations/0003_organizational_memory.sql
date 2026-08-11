-- Expands the schema from "decisions + assumptions" into the full
-- organizational memory model decision.md §8–§15 describes: projects,
-- evidence provenance, an append-only memory event trail, agent runs, and
-- per-candidate retrieval scoring.
--
-- Naming note: `tenants` IS the organization concept from the spec
-- (`organization_id` there == `tenant_id` here). Renaming the table would
-- churn every query for a cosmetic difference, so it stays — see
-- docs/memory-model.md for the full spec-to-schema mapping. Likewise
-- `decision_options` covers the spec's `decision_alternatives` (it stores
-- the chosen option too, via is_chosen) and `conflict_events` covers
-- `decision_conflicts`.

-- ── Projects ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name STRING NOT NULL,
  description STRING,
  created_by UUID REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS projects_tenant_idx ON projects (tenant_id, created_at DESC);

-- ── Decisions: richer lifecycle ─────────────────────────────────────────────
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects (id) ON DELETE CASCADE;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS confidence FLOAT8 NOT NULL DEFAULT 0.7;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS importance FLOAT8 NOT NULL DEFAULT 0.6;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS superseded_by_decision_id UUID REFERENCES decisions (id);
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- 0001 shipped a narrower status vocabulary; migrate the one value that
-- changed name before adding the constraint that would otherwise reject it.
UPDATE decisions SET status = 'REOPENED' WHERE status = 'RECONSIDERED';

ALTER TABLE decisions ADD CONSTRAINT decisions_status_check
  CHECK (status IN ('DRAFT', 'ACTIVE', 'AT_RISK', 'REOPENED', 'SUPERSEDED', 'ARCHIVED'));

CREATE INDEX IF NOT EXISTS decisions_project_idx ON decisions (project_id, status);

-- ── Assumptions: validity states, importance, authority ─────────────────────
-- The spec calls this field validity_status and gives it five states, not
-- two — a decision can be *challenged* by weak evidence without being
-- invalidated by it (see §20: "never allow a low-authority random document
-- to silently invalidate an important decision").
ALTER TABLE assumptions RENAME COLUMN status TO validity_status;

ALTER TABLE assumptions ADD COLUMN IF NOT EXISTS normalized_statement STRING;
ALTER TABLE assumptions ADD COLUMN IF NOT EXISTS assumption_type STRING NOT NULL DEFAULT 'QUANTITATIVE';
ALTER TABLE assumptions ADD COLUMN IF NOT EXISTS importance FLOAT8 NOT NULL DEFAULT 0.6;
ALTER TABLE assumptions ADD COLUMN IF NOT EXISTS confidence FLOAT8 NOT NULL DEFAULT 0.7;
ALTER TABLE assumptions ADD COLUMN IF NOT EXISTS authority_score FLOAT8 NOT NULL DEFAULT 0.7;
ALTER TABLE assumptions ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE assumptions ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ;
ALTER TABLE assumptions ADD COLUMN IF NOT EXISTS invalidated_by_evidence_id UUID;
ALTER TABLE assumptions ADD COLUMN IF NOT EXISTS challenged_at TIMESTAMPTZ;

ALTER TABLE assumptions ADD CONSTRAINT assumptions_validity_check
  CHECK (validity_status IN ('VALID', 'UNCERTAIN', 'CHALLENGED', 'INVALIDATED', 'SUPERSEDED'));

ALTER TABLE assumptions ADD CONSTRAINT assumptions_type_check
  CHECK (assumption_type IN ('QUANTITATIVE', 'QUALITATIVE', 'REGULATORY', 'CAPACITY', 'TEMPORAL'));

-- ── Documents: provenance and authority ─────────────────────────────────────
ALTER TABLE documents ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects (id) ON DELETE CASCADE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_type STRING NOT NULL DEFAULT 'OTHER';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS authority_score FLOAT8 NOT NULL DEFAULT 0.6;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_hash STRING;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS page_count INT8;

ALTER TABLE documents ADD CONSTRAINT documents_source_type_check
  CHECK (source_type IN ('CONTRACT', 'VENDOR_OFFICIAL', 'INTERNAL_ANALYSIS', 'NEWS', 'UNVERIFIED', 'OTHER'));

-- Content hash makes re-uploading the same file a no-op rather than a second
-- set of conflicts (§72: "can duplicate documents create duplicate conflicts?").
CREATE INDEX IF NOT EXISTS documents_content_hash_idx ON documents (tenant_id, content_hash);

-- ── Memory chunks: source location + retrieval signals ──────────────────────
ALTER TABLE memory_chunks ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects (id) ON DELETE CASCADE;
ALTER TABLE memory_chunks ADD COLUMN IF NOT EXISTS page_number INT8;
ALTER TABLE memory_chunks ADD COLUMN IF NOT EXISTS chunk_index INT8;
ALTER TABLE memory_chunks ADD COLUMN IF NOT EXISTS content_hash STRING;
ALTER TABLE memory_chunks ADD COLUMN IF NOT EXISTS importance FLOAT8 NOT NULL DEFAULT 0.5;
ALTER TABLE memory_chunks ADD COLUMN IF NOT EXISTS authority_score FLOAT8 NOT NULL DEFAULT 0.6;
ALTER TABLE memory_chunks ADD COLUMN IF NOT EXISTS metadata JSONB;

CREATE INDEX IF NOT EXISTS memory_chunks_hash_idx ON memory_chunks (tenant_id, content_hash);

-- ── Decision evidence: which document/chunk supports or contradicts what ────
CREATE TABLE IF NOT EXISTS decision_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  decision_id UUID NOT NULL REFERENCES decisions (id) ON DELETE CASCADE,
  assumption_id UUID REFERENCES assumptions (id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents (id) ON DELETE CASCADE,
  memory_chunk_id UUID REFERENCES memory_chunks (id) ON DELETE SET NULL,
  evidence_type STRING NOT NULL,
  relevance FLOAT8 NOT NULL DEFAULT 0.5,
  excerpt STRING,
  page_number INT8,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT decision_evidence_type_check
    CHECK (evidence_type IN ('SUPPORTING', 'CONTRADICTING', 'CONTEXT', 'OUTCOME'))
);

CREATE INDEX IF NOT EXISTS decision_evidence_decision_idx ON decision_evidence (decision_id, evidence_type);
CREATE INDEX IF NOT EXISTS decision_evidence_assumption_idx ON decision_evidence (assumption_id);

-- ── Decision outcomes: what actually happened afterwards ────────────────────
CREATE TABLE IF NOT EXISTS decision_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  decision_id UUID NOT NULL REFERENCES decisions (id) ON DELETE CASCADE,
  summary STRING NOT NULL,
  sentiment STRING NOT NULL DEFAULT 'NEUTRAL',
  recorded_by UUID REFERENCES users (id),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT decision_outcomes_sentiment_check
    CHECK (sentiment IN ('POSITIVE', 'NEUTRAL', 'NEGATIVE'))
);

CREATE INDEX IF NOT EXISTS decision_outcomes_decision_idx ON decision_outcomes (decision_id, observed_at DESC);

-- ── Memory events: append-only trail behind the decision timeline ───────────
-- §14: "Do not silently mutate history without leaving an audit trail."
-- audit_events records *who did what to the system*; memory_events records
-- *what happened to a memory* — they answer different questions and the
-- decision timeline (§24) is built from this one.
CREATE TABLE IF NOT EXISTS memory_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects (id) ON DELETE CASCADE,
  entity_type STRING NOT NULL,
  entity_id UUID NOT NULL,
  decision_id UUID REFERENCES decisions (id) ON DELETE CASCADE,
  event_type STRING NOT NULL,
  agent_run_id UUID,
  actor_type STRING NOT NULL DEFAULT 'SYSTEM',
  actor_user_id UUID REFERENCES users (id),
  summary STRING,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memory_events_actor_check
    CHECK (actor_type IN ('USER', 'AGENT', 'SYSTEM'))
);

CREATE INDEX IF NOT EXISTS memory_events_decision_idx ON memory_events (decision_id, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_events_tenant_idx ON memory_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_events_entity_idx ON memory_events (entity_type, entity_id);

-- ── Agent runs: one row per execution of the §17 memory pipeline ────────────
CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects (id) ON DELETE CASCADE,
  session_id STRING NOT NULL,
  request STRING,
  intent STRING NOT NULL DEFAULT 'UNKNOWN',
  model STRING,
  status STRING NOT NULL DEFAULT 'RUNNING',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  latency_ms INT8,
  retrieval_latency_ms INT8,
  memories_retrieved INT8 NOT NULL DEFAULT 0,
  memories_written INT8 NOT NULL DEFAULT 0,
  conflicts_detected INT8 NOT NULL DEFAULT 0,
  token_usage JSONB,
  output_summary STRING,
  error STRING,
  created_by UUID REFERENCES users (id),
  CONSTRAINT agent_runs_status_check
    CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT agent_runs_intent_check
    CHECK (intent IN ('EXTRACT_DECISION', 'INGEST_EVIDENCE', 'CONFLICT_CHECK', 'ANSWER_QUESTION', 'MEMORY_ANALYSIS', 'UNKNOWN'))
);

CREATE INDEX IF NOT EXISTS agent_runs_tenant_idx ON agent_runs (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_session_idx ON agent_runs (session_id);

-- ── Retrieval events: per-candidate hybrid scores ───────────────────────────
-- The normalized, queryable form of what the Memory Inspector shows. Kept
-- alongside memory_traces.candidates deliberately: this table powers
-- aggregate observability (§32 — average retrieval latency, cross-session
-- recall counts), while the trace keeps a self-contained provenance snapshot
-- of one action even if scoring weights later change.
CREATE TABLE IF NOT EXISTS retrieval_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  agent_run_id UUID REFERENCES agent_runs (id) ON DELETE CASCADE,
  memory_trace_id UUID REFERENCES memory_traces (id) ON DELETE CASCADE,
  memory_type STRING NOT NULL,
  memory_id UUID NOT NULL,
  memory_chunk_id UUID REFERENCES memory_chunks (id) ON DELETE CASCADE,
  similarity_score FLOAT8 NOT NULL,
  importance_score FLOAT8 NOT NULL DEFAULT 0,
  authority_score FLOAT8 NOT NULL DEFAULT 0,
  contextual_score FLOAT8 NOT NULL DEFAULT 0,
  final_score FLOAT8 NOT NULL,
  selected_for_context BOOL NOT NULL DEFAULT false,
  cross_session BOOL NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retrieval_events_run_idx ON retrieval_events (agent_run_id, final_score DESC);
CREATE INDEX IF NOT EXISTS retrieval_events_tenant_idx ON retrieval_events (tenant_id, created_at DESC);

-- ── Conflicts: classification, confidence, resolution ───────────────────────
ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS conflict_type STRING NOT NULL DEFAULT 'EVIDENCE_CONTRADICTS';
ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS relation STRING NOT NULL DEFAULT 'CONTRADICTS';
ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS confidence FLOAT8 NOT NULL DEFAULT 0.8;
ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS old_value STRING;
ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS new_value STRING;
ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS source_quote STRING;
ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS memory_chunk_id UUID REFERENCES memory_chunks (id) ON DELETE SET NULL;
ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS agent_run_id UUID REFERENCES agent_runs (id) ON DELETE SET NULL;
ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS detection_method STRING NOT NULL DEFAULT 'DETERMINISTIC';
ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS resolution STRING;
ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES users (id);

ALTER TABLE conflict_events ADD CONSTRAINT conflict_events_type_check
  CHECK (conflict_type IN ('VALUE_CHANGED', 'POLICY_CHANGED', 'CONSTRAINT_CHANGED', 'EVIDENCE_CONTRADICTS', 'ASSUMPTION_EXPIRED', 'OUTCOME_DISPROVES'));

ALTER TABLE conflict_events ADD CONSTRAINT conflict_events_relation_check
  CHECK (relation IN ('SUPPORTS', 'CONTRADICTS', 'UPDATES', 'IRRELEVANT', 'UNCERTAIN'));

ALTER TABLE conflict_events ADD CONSTRAINT conflict_events_resolution_check
  CHECK (resolution IS NULL OR resolution IN ('REOPENED', 'DISMISSED', 'ACCEPTED', 'SUPERSEDED'));

ALTER TABLE conflict_events ADD CONSTRAINT conflict_events_method_check
  CHECK (detection_method IN ('DETERMINISTIC', 'SEMANTIC'));

-- ── Memory traces: link back to the agent run that produced them ────────────
ALTER TABLE memory_traces ADD COLUMN IF NOT EXISTS agent_run_id UUID REFERENCES agent_runs (id) ON DELETE CASCADE;
ALTER TABLE memory_traces ADD COLUMN IF NOT EXISTS retrieval_latency_ms INT8;
ALTER TABLE memory_traces ADD COLUMN IF NOT EXISTS scoring_weights JSONB;

CREATE INDEX IF NOT EXISTS memory_traces_run_idx ON memory_traces (agent_run_id);
