import { sql } from "@/db/client";
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
    sourceType: row.source_type as MemorySourceType,
    sourceId: row.source_id as string,
    decisionId: (row.decision_id as string) ?? null,
    content: row.content as string,
    embeddingModel: row.embedding_model as string,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export async function insertMemoryChunk(input: {
  tenantId: string;
  sourceType: MemorySourceType;
  sourceId: string;
  decisionId?: string | null;
  content: string;
  embedding: number[];
  embeddingModel: string;
}): Promise<MemoryChunk> {
  const vectorLiteral = toVectorLiteral(input.embedding);
  const [row] = await sql`
    INSERT INTO memory_chunks (
      tenant_id, source_type, source_id, decision_id, content, embedding, embedding_model
    ) VALUES (
      ${input.tenantId}, ${input.sourceType}, ${input.sourceId},
      ${input.decisionId ?? null}, ${input.content},
      ${vectorLiteral}::VECTOR(512), ${input.embeddingModel}
    )
    RETURNING *
  `;
  return mapChunk(row);
}

export interface VectorSearchResult {
  candidates: MemoryChunkCandidate[];
  renderedSql: string;
}

/**
 * Cosine-similarity search over the tenant's whole memory surface. Uses the
 * pgvector-compatible `<=>` cosine-distance operator, which CockroachDB's
 * VECTOR type supports directly — this query is identical whether or not the
 * optional C-SPANN ANN index (0002_vector_index.optional.sql) exists on the
 * cluster; the index just makes it fast at scale instead of a full scan.
 *
 * Deliberately NOT scoped to a single decision — this is what lets a new
 * document "independently recall" the decision it relates to, instead of
 * being told which decision to check.
 */
export async function searchMemoryChunks(
  tenantId: string,
  queryEmbedding: number[],
  opts: { limit?: number; sourceType?: MemorySourceType } = {},
): Promise<VectorSearchResult> {
  const limit = opts.limit ?? 8;
  const vectorLiteral = toVectorLiteral(queryEmbedding);

  const rows = opts.sourceType
    ? await sql`
        SELECT id, tenant_id, source_type, source_id, decision_id, content,
               1 - (embedding <=> ${vectorLiteral}::VECTOR(512)) AS similarity
        FROM memory_chunks
        WHERE tenant_id = ${tenantId} AND source_type = ${opts.sourceType}
        ORDER BY embedding <=> ${vectorLiteral}::VECTOR(512)
        LIMIT ${limit}
      `
    : await sql`
        SELECT id, tenant_id, source_type, source_id, decision_id, content,
               1 - (embedding <=> ${vectorLiteral}::VECTOR(512)) AS similarity
        FROM memory_chunks
        WHERE tenant_id = ${tenantId}
        ORDER BY embedding <=> ${vectorLiteral}::VECTOR(512)
        LIMIT ${limit}
      `;

  const candidates: MemoryChunkCandidate[] = rows.map((row) => ({
    chunkId: row.id as string,
    sourceType: row.source_type as MemorySourceType,
    sourceId: row.source_id as string,
    decisionId: (row.decision_id as string) ?? null,
    contentPreview: (row.content as string).slice(0, 240),
    similarity: Number(row.similarity),
  }));

  const renderedSql = [
    "SELECT id, source_type, source_id, decision_id, content,",
    "       1 - (embedding <=> $1::VECTOR(512)) AS similarity",
    "FROM memory_chunks",
    opts.sourceType
      ? `WHERE tenant_id = $2 AND source_type = '${opts.sourceType}'`
      : "WHERE tenant_id = $2",
    "ORDER BY embedding <=> $1::VECTOR(512)",
    `LIMIT ${limit};`,
    "",
    `-- $1 = query embedding (${queryEmbedding.length} dims, values omitted for brevity)`,
    `-- $2 = '${tenantId}'`,
  ].join("\n");

  return { candidates, renderedSql };
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
  chunkIds: string[],
): Promise<MemoryChunk[]> {
  if (chunkIds.length === 0) return [];
  const rows = await sql`SELECT * FROM memory_chunks WHERE id IN ${sql(chunkIds)}`;
  return rows.map(mapChunk);
}

export const EMBEDDING_DIM = EMBEDDING_DIMENSIONS;
