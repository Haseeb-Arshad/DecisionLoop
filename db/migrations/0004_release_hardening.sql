-- Release hardening: durable memory-index state, retry deduplication, and
-- evidence idempotency. Nullable keys preserve the existing behavior for
-- writes that do not opt into retries while preventing duplicate retry rows.

ALTER TABLE decisions ADD COLUMN IF NOT EXISTS memory_index_status STRING NOT NULL DEFAULT 'PENDING';
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS memory_index_error STRING;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS memory_indexed_at TIMESTAMPTZ;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS commit_key STRING;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS commit_fingerprint STRING;

ALTER TABLE decisions ADD CONSTRAINT decisions_memory_index_status_check
  CHECK (memory_index_status IN ('PENDING', 'INDEXED', 'FAILED'));

ALTER TABLE memory_events ADD COLUMN IF NOT EXISTS dedupe_key STRING;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS dedupe_key STRING;

CREATE UNIQUE INDEX IF NOT EXISTS decisions_tenant_commit_key_idx
  ON decisions (tenant_id, commit_key);

CREATE UNIQUE INDEX IF NOT EXISTS memory_events_tenant_dedupe_key_idx
  ON memory_events (tenant_id, dedupe_key);

CREATE UNIQUE INDEX IF NOT EXISTS audit_events_tenant_dedupe_key_idx
  ON audit_events (tenant_id, dedupe_key);

CREATE UNIQUE INDEX IF NOT EXISTS decision_evidence_document_type_idx
  ON decision_evidence (tenant_id, decision_id, document_id, evidence_type);
