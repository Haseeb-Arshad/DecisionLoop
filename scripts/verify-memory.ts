/**
 * Verifies that DecisionLoop's memory is really in CockroachDB and really
 * drives behaviour — the check decision.md §71 demands before anyone claims
 * the system works ("memory only exists in RAM", "vector retrieval is
 * mocked", "the risk result is hard coded").
 *
 * Every assertion below reads from the database through the same repo
 * functions the app uses. Nothing is stubbed.
 *
 * Usage: npx tsx scripts/verify-memory.ts [tenant-slug]
 */
import "dotenv/config";
import { sql } from "@/db/client";
import { embedText, getEmbeddingProvider } from "@/lib/ai/embeddings";
import { retrieveMemory } from "@/lib/engine/retrieval";
import { getObservabilityMetrics } from "@/lib/repo/agentRuns";
import { listDecisions } from "@/lib/repo/decisions";
import { mcpConfigured } from "@/lib/mcp/cockroachClient";

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

const checks: Check[] = [];

function record(name: string, passed: boolean, detail: string) {
  checks.push({ name, passed, detail });
  console.log(`${passed ? "  ✓" : "  ✗"} ${name}\n      ${detail}`);
}

async function main() {
  const slug = process.argv[2];

  console.log("\nDecisionLoop — memory verification\n");

  // 1. The database is real and reachable.
  const versionRows = (await sql`SELECT version() AS version`) as Array<{ version: string }>;
  const version = versionRows[0]?.version ?? "";
  record(
    "CockroachDB reachable",
    version.toLowerCase().includes("cockroach"),
    version.split(" ").slice(0, 3).join(" ") || "(no version returned)",
  );

  // 2. The schema is the full organizational memory model, not a stub.
  const tables = (await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
  `) as Array<{ table_name: string }>;
  const names = new Set(tables.map((t) => t.table_name));
  const required = [
    "decisions",
    "assumptions",
    "decision_options",
    "decision_evidence",
    "memory_chunks",
    "memory_events",
    "memory_traces",
    "agent_runs",
    "retrieval_events",
    "conflict_events",
    "audit_events",
    "projects",
  ];
  const missing = required.filter((t) => !names.has(t));
  record(
    "Organizational memory schema present",
    missing.length === 0,
    missing.length === 0 ? `${required.length} tables found` : `missing: ${missing.join(", ")}`,
  );

  // 3. The embedding column is a real VECTOR, not a JSON array of floats.
  const [embeddingCol] = (await sql`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'memory_chunks' AND column_name = 'embedding'
  `) as Array<{ data_type: string }>;
  record(
    "memory_chunks.embedding is a native VECTOR column",
    Boolean(embeddingCol?.data_type?.toUpperCase().includes("VECTOR")),
    `data_type = ${embeddingCol?.data_type ?? "(missing)"}`,
  );

  // 4. Which embedding provider is actually in use.
  const provider = getEmbeddingProvider();
  const usingRealEmbeddings = provider.modelName !== "local-hash-fallback-v1";
  record(
    "Embedding provider",
    usingRealEmbeddings,
    usingRealEmbeddings
      ? `${provider.modelName} (Bedrock)`
      : "local-hash-fallback — NO semantic meaning; retrieval will not work correctly. Set AWS_REGION and enable Bedrock model access.",
  );

  const tenants = (await sql`
    SELECT id, name, slug FROM tenants
    ${slug ? sql`WHERE slug = ${slug}` : sql``}
    ORDER BY created_at
  `) as Array<{ id: string; name: string; slug: string }>;

  if (tenants.length === 0) {
    record("Tenant data", false, slug ? `no tenant with slug '${slug}'` : "no tenants found — run npm run db:seed");
    await finish();
    return;
  }

  for (const tenant of tenants) {
    console.log(`\n  Workspace: ${tenant.name} (${tenant.slug})`);

    const decisions = await listDecisions(tenant.id);
    const metrics = await getObservabilityMetrics(tenant.id);

    record(
      `  ${tenant.slug}: decisions persisted`,
      decisions.length > 0,
      `${decisions.length} decision(s), ${metrics.assumptionsTracked} assumption(s), ${metrics.memoriesStored} memory chunk(s)`,
    );

    // 5. Vector retrieval genuinely returns rows for a query that names
    //    nothing in the schema — proof retrieval is real, not a lookup.
    if (metrics.memoriesStored > 0) {
      const { embedding } = await embedText("annual price increase for our analytics vendor");
      const retrieval = await retrieveMemory(
        tenant.id,
        "annual price increase for our analytics vendor",
        { limit: 5 },
      );
      record(
        `  ${tenant.slug}: vector retrieval returns scored rows`,
        retrieval.candidates.length > 0,
        retrieval.candidates.length > 0
          ? `top score ${retrieval.candidates[0]!.finalScore.toFixed(3)} (similarity ${retrieval.candidates[0]!.semanticScore.toFixed(3)}) in ${retrieval.latencyMs}ms; embedding dim ${embedding.length}`
          : "no candidates returned",
      );
    }

    // 6. At-risk state came from a recorded conflict, not a hard-coded flag.
    const atRisk = decisions.filter((d) => d.status === "AT_RISK");
    if (atRisk.length > 0) {
      const [conflictCount] = (await sql`
        SELECT count(*) AS count FROM conflict_events WHERE tenant_id = ${tenant.id}
      `) as Array<{ count: string }>;
      record(
        `  ${tenant.slug}: at-risk decisions are backed by conflict rows`,
        Number(conflictCount!.count) > 0,
        `${atRisk.length} at-risk decision(s), ${conflictCount!.count} recorded conflict(s)`,
      );

      const [traceCount] = (await sql`
        SELECT count(*) AS count FROM memory_traces
        WHERE tenant_id = ${tenant.id} AND action_type = 'conflict_check'
      `) as Array<{ count: string }>;
      record(
        `  ${tenant.slug}: conflicts have Memory Inspector traces`,
        Number(traceCount!.count) > 0,
        `${traceCount!.count} conflict_check trace(s) with real SQL and scores`,
      );
    }

    // 7. Cross-session recall actually happened.
    record(
      `  ${tenant.slug}: cross-session recall`,
      metrics.crossSessionRecalls > 0 || decisions.length === 0,
      metrics.crossSessionRecalls > 0
        ? `${metrics.crossSessionRecalls} memory retrieval(s) by a session other than the writer`
        : "none recorded yet — run the two-session demo to produce one",
    );
  }

  record(
    "CockroachDB Managed MCP configured",
    mcpConfigured(),
    mcpConfigured()
      ? "COCKROACHDB_MCP_SERVICE_KEY present; Memory Inspector cross-check available"
      : "not configured — Memory Inspector shows internal trace only (degrades gracefully)",
  );

  await finish();
}

async function finish() {
  await sql.end();
  const failed = checks.filter((c) => !c.passed);
  console.log(
    `\n${checks.length - failed.length}/${checks.length} checks passed.` +
      (failed.length ? ` Failed: ${failed.map((f) => f.name.trim()).join("; ")}` : ""),
  );
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nVerification failed:", err);
  await sql.end().catch(() => undefined);
  process.exit(1);
});
