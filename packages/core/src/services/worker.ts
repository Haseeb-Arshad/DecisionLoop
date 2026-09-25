import type { DecisionStore } from "../ports/store";
import type { Job } from "../types/records";
import { silentLogger, type Logger } from "./shared";

/**
 * Durable job worker (spec §18). The smallest operationally credible
 * design: jobs live in the database, workers claim them with
 * `FOR UPDATE SKIP LOCKED`, failures retry with exponential backoff and
 * jitter, exhausted jobs move to DEAD with their last error visible, and a
 * worker that dies mid-job has its lock reclaimed after a timeout.
 *
 * The handler map is the seam for a dedicated workflow engine later: the
 * same handlers can be registered with one if scale ever requires it.
 */

export type JobHandler = (job: Job) => Promise<Record<string, unknown> | null>;

export interface WorkerOptions {
  workerId: string;
  batchSize?: number;
  pollIntervalMs?: number;
  backoffBaseMs?: number;
  maxBackoffMs?: number;
  lockTimeoutMs?: number;
  logger?: Logger;
}

export function backoffDelay(attempt: number, baseMs = 2_000, maxMs = 10 * 60_000, random = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp * (0.5 + random() * 0.5));
}

/** Errors that retrying cannot fix (bad input, missing rows) go straight to DEAD. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export class Worker {
  private stopped = false;
  private readonly log: Logger;

  constructor(
    private readonly store: DecisionStore,
    private readonly handlers: Record<string, JobHandler>,
    private readonly opts: WorkerOptions,
  ) {
    this.log = opts.logger ?? silentLogger;
  }

  /** Claims and runs one batch. Returns how many jobs were processed. */
  async runOnce(): Promise<number> {
    const jobs = await this.store.claimJobs(this.opts.workerId, this.opts.batchSize ?? 5, {
      kinds: Object.keys(this.handlers),
      lockTimeoutMs: this.opts.lockTimeoutMs,
    });
    for (const job of jobs) await this.runJob(job);
    return jobs.length;
  }

  private async runJob(job: Job): Promise<void> {
    const handler = this.handlers[job.kind];
    const started = Date.now();
    try {
      if (!handler) throw new PermanentJobError(`No handler for job kind ${job.kind}.`);
      const result = await handler(job);
      await this.store.completeJob(job.id, result);
      this.log.info({ jobId: job.id, kind: job.kind, ms: Date.now() - started }, "job succeeded");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryAt =
        err instanceof PermanentJobError
          ? null
          : new Date(Date.now() + backoffDelay(job.attempts, this.opts.backoffBaseMs, this.opts.maxBackoffMs));
      const updated = await this.store.failJob(job.id, message, retryAt);
      this.log[updated.status === "DEAD" ? "error" : "warn"](
        { jobId: job.id, kind: job.kind, attempts: updated.attempts, status: updated.status, err: message },
        updated.status === "DEAD" ? "job dead-lettered" : "job failed; will retry",
      );
    }
  }

  /** Runs until `stop()` or the signal aborts. */
  async start(signal?: AbortSignal): Promise<void> {
    const poll = this.opts.pollIntervalMs ?? 1_000;
    while (!this.stopped && !signal?.aborted) {
      let processed = 0;
      try {
        processed = await this.runOnce();
      } catch (err) {
        this.log.error({ err: err instanceof Error ? err.message : String(err) }, "worker poll failed");
      }
      if (processed === 0) await new Promise((r) => setTimeout(r, poll));
    }
  }

  stop(): void {
    this.stopped = true;
  }
}

/** Runs queued jobs to completion — tests, the CLI's one-shot mode and local `serve`. */
export async function drainJobs(worker: Worker, maxRounds = 50): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxRounds; i++) {
    const n = await worker.runOnce();
    total += n;
    if (n === 0) break;
  }
  return total;
}
