"use client";
import { PageHeader, QueryState } from "@/components/Workspace";
import { useWorkspace } from "@/lib/workspace";
import { useV1 } from "@/lib/v1";
import type { WorkspaceOverview } from "@decisionloop/core/ports/store";
export default function SystemPage() {
  const ws = useWorkspace();
  const overview = useV1<WorkspaceOverview>(["overview"], "/overview", {
    refetchInterval: 10000,
  });
  const caps = ws.data?.capabilities;
  const fresh = caps?.workerHealthy;
  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Operational visibility"
        title="System health"
        description="Connection and provider state, background processing, and workspace activity from the running system."
      />
      <QueryState loading={ws.isLoading} error={ws.error} retry={ws.refetch} />
      {caps && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="card form-section">
            <h2>Runtime</h2>
            <dl className="mt-5 divide-y divide-ink-800 text-sm">
              {[
                ["Database", "Connected"],
                [
                  "Background worker",
                  fresh ? "Running" : "No recent heartbeat",
                ],
                [
                  "Last worker heartbeat",
                  caps.workerSeenAt
                    ? new Date(caps.workerSeenAt).toLocaleString()
                    : "Not observed",
                ],
                ["Pending / retrying jobs", String(caps.pendingJobs)],
                [
                  "Oldest pending job",
                  caps.oldestJobAt
                    ? new Date(caps.oldestJobAt).toLocaleString()
                    : "None",
                ],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-4">
                  <dt className="text-ink-400">{k}</dt>
                  <dd
                    className={
                      k === "Background worker" && !fresh
                        ? "text-risk-600"
                        : "text-ink-100"
                    }
                  >
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="card form-section">
            <h2>Configured capabilities</h2>
            <dl className="mt-5 divide-y divide-ink-800 text-sm">
              {[
                ["Reasoning provider", caps.reasoning],
                ["Embedding provider", caps.embeddings],
                [
                  "Document upload",
                  caps.documentUpload ? "Configured" : "Not configured",
                ],
                ["Structured checking", "Available"],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="flex flex-wrap justify-between gap-3 py-4"
                >
                  <dt className="text-ink-400">{k}</dt>
                  <dd className="max-w-full break-all">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 rounded-lg bg-ink-950 p-4 text-xs leading-6 text-ink-400">
              Configured providers describe runtime settings. A successful
              request is required to prove external model or storage access.
            </p>
          </section>
        </div>
      )}
      <section className="mt-8">
        <h2 className="section-label">Workspace counters</h2>
        <QueryState
          loading={overview.isLoading}
          error={overview.error}
          retry={overview.refetch}
        />
        {overview.data && (
          <div className="card form-section">
            <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(overview.data)
                .filter(([, v]) => typeof v === "number")
                .map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-ink-400">
                      {k.replace(/([A-Z])/g, " $1").toLowerCase()}
                    </dt>
                    <dd className="mt-2 text-2xl font-semibold">{String(v)}</dd>
                  </div>
                ))}
            </dl>
          </div>
        )}
      </section>
    </div>
  );
}
