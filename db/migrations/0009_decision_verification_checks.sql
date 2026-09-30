-- Workflow links are queried on every completed run, so keep them as indexed rows.
CREATE TABLE IF NOT EXISTS decision_verification_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  decision_id UUID NOT NULL REFERENCES decisions (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  repository TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'TEST',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT decision_verification_check_kind CHECK (kind IN ('TEST', 'BENCHMARK', 'RUNTIME')),
  CONSTRAINT decision_verification_check_unique UNIQUE (tenant_id, decision_id, repository, name)
);

CREATE INDEX IF NOT EXISTS decision_verification_check_lookup_idx
  ON decision_verification_checks (tenant_id, repository, name);

-- Recover links written by the earlier metadata implementation. postgres.js
-- encoded some JSONB parameters as strings, so both shapes are supported.
WITH normalized AS (
  SELECT d.tenant_id, d.id AS decision_id,
    CASE jsonb_typeof(d.metadata)
      WHEN 'object' THEN d.metadata
      WHEN 'string' THEN (d.metadata #>> '{}')::jsonb
      ELSE '{}'::jsonb
    END AS body
  FROM decisions d
), linked AS (
  SELECT tenant_id, decision_id,
    CASE jsonb_typeof(body->'verificationChecks')
      WHEN 'array' THEN body->'verificationChecks'
      WHEN 'string' THEN (body->>'verificationChecks')::jsonb
      ELSE '[]'::jsonb
    END AS checks
  FROM normalized
)
INSERT INTO decision_verification_checks (tenant_id, decision_id, name, repository, kind, description)
SELECT linked.tenant_id, linked.decision_id, c.check_json->>'name', lower(c.check_json->>'repository'),
  CASE WHEN c.check_json->>'kind' IN ('BENCHMARK', 'RUNTIME') THEN c.check_json->>'kind' ELSE 'TEST' END,
  c.check_json->>'description'
FROM linked
CROSS JOIN LATERAL jsonb_array_elements(linked.checks) AS c(check_json)
WHERE c.check_json->>'name' IS NOT NULL AND c.check_json->>'repository' IS NOT NULL
ON CONFLICT (tenant_id, decision_id, repository, name) DO NOTHING;
