-- PostgreSQL + pgvector counterpart of 0002 (CockroachDB C-SPANN index).
-- Optional: retrieval falls back to an exact scan without it.
CREATE INDEX IF NOT EXISTS memory_chunks_embedding_hnsw_idx
  ON memory_chunks USING hnsw (embedding vector_cosine_ops);
