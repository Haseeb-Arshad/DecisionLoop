-- Shared counters work across web replicas; no passwords or raw IPs are stored.
CREATE TABLE IF NOT EXISTS request_limits (
  key_hash TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  count INT8 NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS request_limits_expiry_idx ON request_limits (window_start);
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id TEXT PRIMARY KEY,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
