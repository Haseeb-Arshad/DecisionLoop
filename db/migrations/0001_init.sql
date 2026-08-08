-- DecisionLoop initial schema.
-- Written for CockroachDB (Postgres wire-compatible). Applied by db/migrate.ts.

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name STRING NOT NULL,
  slug STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  email STRING NOT NULL,
  password_hash STRING NOT NULL,
  name STRING NOT NULL,
  role STRING NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  token_hash STRING NOT NULL,
  user_agent STRING,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (token_hash)
);

CREATE TABLE IF NOT EXISTS decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  title STRING NOT NULL,
  problem_statement STRING,
  reasoning STRING,
  status STRING NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | AT_RISK | RECONSIDERED | ARCHIVED
  risk_explanation STRING,
  created_by UUID REFERENCES users (id),
  created_in_session STRING, -- free-text label used by the demo seed ('session-1', 'session-2', ...)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decision_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID NOT NULL REFERENCES decisions (id) ON DELETE CASCADE,
  name STRING NOT NULL,
  description STRING,
  is_chosen BOOL NOT NULL DEFAULT false,
  rejection_reason STRING,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID NOT NULL REFERENCES decisions (id) ON DELETE CASCADE,
  statement STRING NOT NULL,
  metric STRING,        -- e.g. "annual_price"
  operator STRING,       -- '<' | '<=' | '>' | '>=' | '='
  value FLOAT8,
  unit STRING,           -- e.g. "USD/year"
  status STRING NOT NULL DEFAULT 'VALID', -- VALID | INVALIDATED
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  invalidated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES users (id),
  filename STRING NOT NULL,
  mime_type STRING,
  s3_key STRING NOT NULL,
  size_bytes INT8,
  extracted_text STRING,
  status STRING NOT NULL DEFAULT 'UPLOADED', -- UPLOADED | PROCESSING | PROCESSED | FAILED
  processing_error STRING,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- Unified retrieval surface: one row per retrievable unit (a decision summary,
-- an assumption statement, a document excerpt). This is what gets embedded and
-- vector-searched — see 0002_vector_index.optional.sql for the ANN index.
CREATE TABLE IF NOT EXISTS memory_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  source_type STRING NOT NULL, -- 'decision' | 'assumption' | 'document'
  source_id UUID NOT NULL,
  decision_id UUID REFERENCES decisions (id) ON DELETE CASCADE,
  content STRING NOT NULL,
  embedding VECTOR(512) NOT NULL,
  embedding_model STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conflict_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  decision_id UUID NOT NULL REFERENCES decisions (id) ON DELETE CASCADE,
  assumption_id UUID NOT NULL REFERENCES assumptions (id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents (id),
  fact_statement STRING NOT NULL,
  explanation STRING NOT NULL,
  suggested_option_id UUID REFERENCES decision_options (id),
  memory_trace_id UUID,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Memory Inspector's data source: one row per AI action that touched memory.
CREATE TABLE IF NOT EXISTS memory_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  action_type STRING NOT NULL, -- 'retrieval' | 'conflict_check' | 'extraction' | 'mcp_verify'
  related_decision_id UUID REFERENCES decisions (id),
  related_document_id UUID REFERENCES documents (id),
  query_text STRING,
  rendered_sql STRING,
  candidates JSONB,        -- [{chunkId, sourceType, sourceId, contentPreview, similarity}]
  used_chunk_ids UUID[],
  llm_reasoning STRING,
  mcp_verification JSONB,  -- {verified, toolCalls: [...], rawRows: [...]}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users (id),
  actor_label STRING,   -- 'system' for automated actions
  action STRING NOT NULL,
  entity_type STRING,
  entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS decisions_tenant_idx ON decisions (tenant_id, status);
CREATE INDEX IF NOT EXISTS decision_options_decision_idx ON decision_options (decision_id);
CREATE INDEX IF NOT EXISTS assumptions_decision_idx ON assumptions (decision_id, status);
CREATE INDEX IF NOT EXISTS documents_tenant_idx ON documents (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_chunks_tenant_idx ON memory_chunks (tenant_id, source_type);
CREATE INDEX IF NOT EXISTS memory_chunks_decision_idx ON memory_chunks (decision_id);
CREATE INDEX IF NOT EXISTS conflict_events_decision_idx ON conflict_events (decision_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS memory_traces_tenant_idx ON memory_traces (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_traces_decision_idx ON memory_traces (related_decision_id);
CREATE INDEX IF NOT EXISTS audit_events_tenant_idx ON audit_events (tenant_id, created_at DESC);
