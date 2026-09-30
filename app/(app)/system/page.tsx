"use client";
import { PageHeader, QueryState } from "@/components/Workspace";
import { useWorkspace } from "@/lib/workspace";
import { useV1 } from "@/lib/v1";
import type { WorkspaceOverview } from "@decisionloop/core/ports/store";

const label = (k: string) => k.replace(/([A-Z])/g, " $1").toLowerCase();

export default function SystemPage() {
  const ws = useWorkspace();
  const overview = useV1<WorkspaceOverview>(["overview"], "/overview", { refetchInterval: 10000 });
  const caps = ws.data?.capabilities;
  const fresh = caps?.workerHealthy;

  return (
    <div>
      <PageHeader title="Health" description="What is configured, whether background processing is running, and workspace counters." />
      <QueryState loading={ws.isLoading} error={ws.error} retry={ws.refetch} />
      {caps && (
        <div className="grid gap-8 md:grid-cols-2">
          <section>
            <h2 className="section-label">Processing</h2>
            <dl className="kv">
              <dt>Background worker</dt>
              <dd className={fresh ? "" : "text-risk-600"}>{fresh ? "Running" : "No recent heartbeat"}</dd>
              <dt>Last heartbeat</dt>
              <dd>{caps.workerSeenAt ? new Date(caps.workerSeenAt).toLocaleString() : "Not observed"}</dd>
              <dt>Pending jobs</dt>
              <dd>{caps.pendingJobs}</dd>
              <dt>Oldest pending</dt>
              <dd>{caps.oldestJobAt ? new Date(caps.oldestJobAt).toLocaleString() : "None"}</dd>
            </dl>
          </section>
          <section>
            <h2 className="section-label">Configuration</h2>
            <dl className="kv">
              <dt>Reasoning model</dt>
              <dd>{caps.reasoning === "none" ? "None (comparison only)" : caps.reasoning}</dd>
              <dt>Embeddings</dt>
              <dd>{caps.embeddings}</dd>
              <dt>Document upload</dt>
              <dd>{caps.documentUpload ? "Configured" : "Not configured"}</dd>
            </dl>
            <p className="mt-3 text-xs text-ink-400">These are settings. A successful request is the only proof that a model or store is reachable.</p>
          </section>
        </div>
      )}
      <section className="mt-8">
        <h2 className="section-label">Workspace counters</h2>
        <QueryState loading={overview.isLoading} error={overview.error} retry={overview.refetch} />
        {overview.data && (
          <dl className="kv">
            {Object.entries(overview.data)
              .filter(([, v]) => typeof v === "number")
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt>{label(k)}</dt>
                  <dd className="tabular-nums">{String(v)}</dd>
                </div>
              ))}
          </dl>
        )}
      </section>
    </div>
  );
}
