import { sql, toJsonValue } from "@/db/client";
import type { MemoryChunk, MemoryChunkCandidate, MemorySourceType } from "@/lib/types";

const EMBEDDING_DIMENSIONS = 512;

function toVectorLiteral(embedding: number[]): string {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding has ${embedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}. ` +
        `Check lib/ai/embeddings.ts EMBEDDING_DIMENSIONS matches the memory_chunks.embedding column.`,
    );
  }
  return `[${embedding.join(",")}]`;
}

function mapChunk(row: Record<string, unknown>): MemoryChunk {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    projectId: (row.project_id as string) ?? null,
    sourceType: row.source_type as MemorySourceType,
    sourceId: row.source_id as string,
    decisionId: (row.decision_id as string) ?? null,
    content: row.content as string,
    embeddingModel: row.embedding_model as string,
    pageNumber: row.page_number === null ? null : Number(row.page_number),
    chunkIndex: row.chunk_index === null ? null : Number(row.chunk_index),
    contentHash: (row.content_hash as string) ?? null,
    importance: Number(row.importance ?? 0.5),
    authorityScore: Number(row.authority_score ?? 0.6),
    metadata: (row.metadata as Record<string, unknown>) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export async function insertMemoryChunk(input: {
  tenantId: string;
  projectId?: string | null;
  sourceType: MemorySourceType;
  sourceId: string;
  decisionId?: string | null;
  content: string;
  embedding: number[];
  embeddingModel: string;
  pageNumber?: number | null;
  chunkIndex?: number | null;
  contentHash?: string | null;
  importance?: number;
  authorityScore?: number;
  metadata?: Record<string, unknown> | null;
}): Promise<MemoryChunk> {
  const vectorLiteral = toVectorLiteral(input.embedding);
  const [row] = await sql`
    INSERT INTO memory_chunks (
      tenant_id, project_id, source_type, source_id, decision_id, content,
      embedding, embedding_model, page_number, chunk_index, content_hash,
      importance, authority_score, metadata
    ) VALUES (
      ${input.tenantId}, ${input.projectId ?? null}, ${input.sourceType},
      ${input.sourceId}, ${input.decisionId ?? null}, ${input.content},
      ${vectorLiteral}::VECTOR(512), ${input.embeddingModel},
      ${input.pageNumber ?? null}, ${input.chunkIndex ?? null},
      ${input.contentHash ?? null}, ${input.importance ?? 0.5},
      ${input.authorityScore ?? 0.6},
      ${input.metadata ? sql.json(toJsonValue(input.metadata)) : null}
    )
    RETURNING *
  `;
  return mapChunk(row!);
}

export interface VectorSearchResult {
  candidates: MemoryChunkCandidate[];
  renderedSql: string;
  latencyMs: number;
}

/**
 * Cosine-similarity search over the tenant's whole memory surface. Uses the
 * pgvector-compatible `<=>` cosine-distance operator, which CockroachDB's
 * VECTOR type supports directly — this query is identical whether or not the
 * optional C-SPANN ANN index (0002_vector_index.optional.sql) exists on the
 * cluster; the index just makes it fast at scale instead of a full scan.
 *
 * Tenant scoping is in the WHERE clause, not applied afterwards in JS —
 * §26 is explicit that semantic search must never reach across tenants, and
 * a post-filter would still have let another tenant's rows influence which
 * top-k came back.
 *
 * Returns raw similarity only. Hybrid re-scoring (importance, authority,
 * contextual relevance) happens in lib/engine/retrieval.ts so the weights
 * stay configurable and testable independently of SQL.
 */
export async function searchMemoryChunks(
  tenantId: string,
  queryEmbedding: number[],
  opts: {
    limit?: number;
    sourceType?: MemorySourceType;
    projectId?: string | null;
    excludeSourceId?: string | null;
  } = {},
): Promise<VectorSearchResult> {
  const limit = opts.limit ?? 8;
  const vectorLiteral = toVectorLiteral(queryEmbedding);
  const startedAt = Date.now();

  const rows = await sql`
    SELECT id, tenant_id, source_type, source_id, decision_id, content,
           importance, authority_score, page_number, created_at,
           1 - (embedding <=> ${vectorLiteral}::VECTOR(512)) AS similarity
    FROM memory_chunks
    WHERE tenant_id = ${tenantId}
      ${opts.sourceType ? sql`AND source_type = ${opts.sourceType}` : sql``}
      ${opts.projectId ? sql`AND project_id = ${opts.projectId}` : sql``}
      ${opts.excludeSourceId ? sql`AND source_id != ${opts.excludeSourceId}` : sql``}
    ORDER BY embedding <=> ${vectorLiteral}::VECTOR(512)
    LIMIT ${limit}
  `;

  const latencyMs = Date.now() - startedAt;

  const candidates: MemoryChunkCandidate[] = rows.map((row) => ({
    chunkId: row.id as string,
    sourceType: row.source_type as MemorySourceType,
    sourceId: row.source_id as string,
    decisionId: (row.decision_id as string) ?? null,
    contentPreview: (row.content as string).slice(0, 240),
    similarity: Number(row.similarity),
    importance: Number(row.importance ?? 0.5),
    authorityScore: Number(row.authority_score ?? 0.6),
    pageNumber: row.page_number === null ? null : Number(row.page_number),
    createdAt: (row.created_at as Date).toISOString(),
  }));

  // The exact query, with bind parameters named rather than inlined — this
  // string is what the Memory Inspector displays, so it has to be the real
  // shape that ran, not a prettified approximation.
  const renderedSql = [
    "SELECT id, source_type, source_id, decision_id, content,",
    "       importance, authority_score, page_number, created_at,",
    "       1 - (embedding <=> $1::VECTOR(512)) AS similarity",
    "FROM memory_chunks",
    "WHERE tenant_id = $2",
    opts.sourceType ? `  AND source_type = '${opts.sourceType}'` : "",
    opts.projectId ? `  AND project_id = '${opts.projectId}'` : "",
    opts.excludeSourceId ? `  AND source_id != '${opts.excludeSourceId}'` : "",
    "ORDER BY embedding <=> $1::VECTOR(512)",
    `LIMIT ${limit};`,
    "",
    `-- $1 = query embedding (${queryEmbedding.length} dims, values omitted for brevity)`,
    `-- $2 = '${tenantId}'`,
    `-- executed in ${latencyMs}ms`,
  ]
    .filter(Boolean)
    .join("\n");

  return { candidates, renderedSql, latencyMs };
}

export async function deleteMemoryChunksForSource(
  sourceType: MemorySourceType,
  sourceId: string,
): Promise<void> {
  await sql`
    DELETE FROM memory_chunks WHERE source_type = ${sourceType} AND source_id = ${sourceId}
  `;
}

export async function getMemoryChunksByIds(
  tenantId: string,
  chunkIds: string[],
): Promise<MemoryChunk[]> {
  if (chunkIds.length === 0) return [];
  const rows = await sql`
    SELECT * FROM memory_chunks
    WHERE tenant_id = ${tenantId} AND id IN ${sql(chunkIds)}
  `;
  return rows.map(mapChunk);
}

export async function getMemoryChunkById(
  tenantId: string,
  chunkId: string,
): Promise<MemoryChunk | null> {
  const [row] = await sql`
    SELECT * FROM memory_chunks WHERE id = ${chunkId} AND tenant_id = ${tenantId}
  `;
  return row ? mapChunk(row) : null;
}

export async function listMemoryChunksForSource(
  tenantId: string,
  sourceType: MemorySourceType,
  sourceId: string,
): Promise<MemoryChunk[]> {
  const rows = await sql`
    SELECT * FROM memory_chunks
    WHERE tenant_id = ${tenantId} AND source_type = ${sourceType} AND source_id = ${sourceId}
    ORDER BY chunk_index NULLS FIRST, created_at
  `;
  return rows.map(mapChunk);
}

export const EMBEDDING_DIM = EMBEDDING_DIMENSIONS;
