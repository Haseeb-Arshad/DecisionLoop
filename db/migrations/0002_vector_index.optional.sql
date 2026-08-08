-- CockroachDB C-SPANN distributed vector index (v25.2+). Marked ".optional."
-- because older CockroachDB Serverless clusters may not yet support
-- CREATE VECTOR INDEX — db/migrate.ts catches a failure here, logs a warning,
-- and marks it applied so retrieval falls back to a brute-force
-- `ORDER BY embedding <=> $1 LIMIT k` scan (see lib/repo/memoryChunks.ts),
-- which works on any cluster that has the VECTOR type at all.
CREATE VECTOR INDEX IF NOT EXISTS memory_chunks_embedding_idx
  ON memory_chunks (tenant_id, embedding vector_cosine_ops);
