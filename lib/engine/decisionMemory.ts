import { embedTexts } from "@/lib/ai/embeddings";
import { insertMemoryChunk } from "@/lib/repo/memoryChunks";
import type { DecisionWithDetails } from "@/lib/types";

/**
 * Writes a decision's memory surface into `memory_chunks`: one chunk
 * summarizing the decision + its reasoning, and one chunk per assumption.
 * The assumption chunks are what conflict detection retrieves against — see
 * lib/engine/conflictDetection.ts. Called once, right after
 * lib/repo/decisions.ts#createDecision commits the structured rows.
 */
export async function indexDecisionMemory(
  decision: DecisionWithDetails,
): Promise<{ chunksWritten: number }> {
  const chosen = decision.options.find((o) => o.isChosen);

  const texts: string[] = [];
  const metas: Array<{ sourceType: "decision" | "assumption"; sourceId: string }> = [];

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
  metas.push({ sourceType: "decision", sourceId: decision.id });

  for (const assumption of decision.assumptions) {
    texts.push(
      `Assumption behind decision "${decision.title}": ${assumption.statement}`,
    );
    metas.push({ sourceType: "assumption", sourceId: assumption.id });
  }

  const { embeddings, model } = await embedTexts(texts);

  await Promise.all(
    embeddings.map((embedding, i) =>
      insertMemoryChunk({
        tenantId: decision.tenantId,
        sourceType: metas[i]!.sourceType,
        sourceId: metas[i]!.sourceId,
        decisionId: decision.id,
        content: texts[i]!,
        embedding,
        embeddingModel: model,
      }),
    ),
  );

  return { chunksWritten: texts.length };
}
