-- Domain profiles: suggestions a person approves, and credentials bound to one source system.

-- A learned suggestion (for example "treat dispute_rate as chargeback_rate_pct") is an approval like any other.
ALTER TABLE approval_requests DROP CONSTRAINT IF EXISTS approval_requests_kind_check;
ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_kind_check CHECK (kind IN (
  'COMMIT_DECISION', 'ADD_ASSUMPTION', 'REVIEW_CONFLICT', 'SUPERSEDE_DECISION', 'PROFILE_SUGGESTION'));

-- What a person approved. Consulted by the trigger engine so the next check is plain code, not a model call.
CREATE TABLE IF NOT EXISTS profile_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  approval_id UUID,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT profile_overrides_kind_check CHECK (kind IN ('predicate_alias')),
  CONSTRAINT profile_overrides_unique UNIQUE (tenant_id, kind, key)
);

-- An integration key bound to one source ("erp", "billing"): events it sends are always attributed to that source.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS event_source TEXT;
