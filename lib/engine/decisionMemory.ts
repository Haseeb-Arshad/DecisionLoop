import { embedTexts } from "@/lib/ai/embeddings";
import { insertMemoryChunk } from "@/lib/repo/memoryChunks";
import { recordMemoryEvent } from "@/lib/repo/memoryEvents";
import type { DecisionWithDetails, MemorySourceType } from "@/lib/types";

/**
 * Writes a decision's memory surface into `memory_chunks`: one chunk
 * summarizing the decision and its reasoning, and one chunk per assumption.
 * The assumption chunks are what conflict detection retrieves against —
 * see lib/engine/conflictDetection.ts. Called once, right after
 * lib/repo/decisions.ts#createDecision commits the structured rows.
 *
 * Each chunk carries the retrieval signals the hybrid scorer needs
 * (importance, authority) so ranking doesn't have to join back to the
 * source row at query time.
 */
export async function indexDecisionMemory(
  decision: DecisionWithDetails,
  opts: { agentRunId?: string | null; actorUserId?: string | null } = {},
): Promise<{ chunksWritten: number }> {
  const chosen = decision.options.find((o) => o.isChosen);

  const texts: string[] = [];
  const metas: Array<{
    sourceType: MemorySourceType;
    sourceId: string;
    importance: number;
    authorityScore: number;
  }> = [];

  // The decision summary is written as one retrievable memory so a question
  // like "why did we choose X?" matches the decision itself, not only its
  // individual assumptions.
  const decisionSummary = [
    `Decision: ${decision.title}`,
    decision.problemStatement ? `Problem: ${decision.problemStatement}` : "",
    chosen ? `Chosen option: ${chosen.name} — ${chosen.description ?? ""}` : "",
    decision.reasoning ? `Reasoning: ${decision.reasoning}` : "",
    decision.options
      .filter((o) => !o.isChosen)
      .map((o) => `Rejected: ${o.name}${o.rejectionReason ? ` — ${o.rejectionReason}` : ""}`)
      .join(" "),
  ]
    .filter(Boolean)
    .join("\n");

  texts.push(decisionSummary);
  metas.push({
    sourceType: "decision",
    sourceId: decision.id,
    importance: decision.importance,
    // A committed decision is a first-party organizational record — the most
    // authoritative kind of memory this system holds.
    authorityScore: 0.9,
  });

  for (const assumption of decision.assumptions) {
    texts.push(
      [
        `Assumption behind decision "${decision.title}": ${assumption.statement}`,
        assumption.normalizedStatement ? `Constraint: ${assumption.normalizedStatement}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    metas.push({
      sourceType: "assumption",
      sourceId: assumption.id,
      importance: assumption.importance,
      authorityScore: assumption.authorityScore,
    });
  }

  const { embeddings, model } = await embedTexts(texts);

  await Promise.all(
    embeddings.map((embedding, i) =>
      insertMemoryChunk({
        tenantId: decision.tenantId,
        projectId: decision.projectId,
        sourceType: metas[i]!.sourceType,
        sourceId: metas[i]!.sourceId,
        decisionId: decision.id,
        content: texts[i]!,
        embedding,
        embeddingModel: model,
        importance: metas[i]!.importance,
        authorityScore: metas[i]!.authorityScore,
        chunkIndex: i,
      }),
    ),
  );

  await recordMemoryEvent({
    tenantId: decision.tenantId,
    projectId: decision.projectId,
    entityType: "decision",
    entityId: decision.id,
    decisionId: decision.id,
    eventType: "DECISION_COMMITTED",
    agentRunId: opts.agentRunId ?? null,
    actorType: opts.actorUserId ? "USER" : "SYSTEM",
    actorUserId: opts.actorUserId ?? null,
    summary: `Committed "${decision.title}" with ${decision.assumptions.length} assumption(s) and ${decision.options.length} option(s).`,
    metadata: {
      chosenOption: chosen?.name ?? null,
      assumptionCount: decision.assumptions.length,
    },
  });

  for (const assumption of decision.assumptions) {
    await recordMemoryEvent({
      tenantId: decision.tenantId,
      projectId: decision.projectId,
      entityType: "assumption",
      entityId: assumption.id,
      decisionId: decision.id,
      eventType: "MEMORY_CREATED",
      agentRunId: opts.agentRunId ?? null,
      actorType: opts.actorUserId ? "USER" : "SYSTEM",
      actorUserId: opts.actorUserId ?? null,
      summary: assumption.statement,
      metadata: { normalized: assumption.normalizedStatement, importance: assumption.importance },
    });
  }

  return { chunksWritten: texts.length };
}
