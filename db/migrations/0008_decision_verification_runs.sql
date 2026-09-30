-- Exact, immutable CI receipts attached to the decisions they are intended to verify.
CREATE TABLE IF NOT EXISTS decision_verification_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  decision_id UUID NOT NULL REFERENCES decisions (id) ON DELETE CASCADE,
  event_id UUID REFERENCES event_inbox (id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  source_run_id TEXT NOT NULL,
  check_name TEXT NOT NULL,
  repository TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  conclusion TEXT NOT NULL,
  details_url TEXT,
  completed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT decision_verification_conclusion_check CHECK (
    conclusion IN ('success', 'failure', 'neutral', 'cancelled', 'timed_out', 'action_required', 'stale', 'skipped', 'startup_failure')
  ),
  CONSTRAINT decision_verification_run_unique UNIQUE (tenant_id, decision_id, source, source_run_id)
);

CREATE INDEX IF NOT EXISTS decision_verification_latest_idx
  ON decision_verification_runs (tenant_id, decision_id, check_name, completed_at DESC);
