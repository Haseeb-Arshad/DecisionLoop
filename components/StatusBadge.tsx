import type { AssumptionStatus, DecisionStatus, DocumentStatus } from "@/lib/types";

const DECISION_STYLES: Record<DecisionStatus, string> = {
  ACTIVE: "bg-signal-500/15 text-signal-400 ring-1 ring-inset ring-signal-500/30",
  AT_RISK: "bg-risk-500/15 text-risk-400 ring-1 ring-inset ring-risk-500/40 animate-pulse",
  RECONSIDERED: "bg-ink-600/40 text-ink-200 ring-1 ring-inset ring-ink-500/40",
  ARCHIVED: "bg-ink-700/40 text-ink-400 ring-1 ring-inset ring-ink-600/40",
};

const DECISION_LABELS: Record<DecisionStatus, string> = {
  ACTIVE: "Active",
  AT_RISK: "At risk",
  RECONSIDERED: "Reconsidered",
  ARCHIVED: "Archived",
};

export function DecisionStatusBadge({ status }: { status: DecisionStatus }) {
  return (
    <span className={`pill ${DECISION_STYLES[status]}`}>
      {status === "AT_RISK" && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-risk-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-risk-400" />
        </span>
      )}
      {DECISION_LABELS[status]}
    </span>
  );
}

const ASSUMPTION_STYLES: Record<AssumptionStatus, string> = {
  VALID: "bg-signal-500/10 text-signal-400 ring-1 ring-inset ring-signal-500/25",
  INVALIDATED: "bg-risk-500/10 text-risk-400 ring-1 ring-inset ring-risk-500/30",
};

export function AssumptionStatusBadge({ status }: { status: AssumptionStatus }) {
  return (
    <span className={`pill ${ASSUMPTION_STYLES[status]}`}>
      {status === "VALID" ? "Valid" : "Invalidated"}
    </span>
  );
}

const DOCUMENT_STYLES: Record<DocumentStatus, string> = {
  UPLOADED: "bg-ink-600/40 text-ink-200 ring-1 ring-inset ring-ink-500/40",
  PROCESSING: "bg-ink-600/40 text-ink-200 ring-1 ring-inset ring-ink-500/40 animate-pulse",
  PROCESSED: "bg-signal-500/15 text-signal-400 ring-1 ring-inset ring-signal-500/30",
  FAILED: "bg-risk-500/15 text-risk-400 ring-1 ring-inset ring-risk-500/40",
};

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  return <span className={`pill ${DOCUMENT_STYLES[status]}`}>{status.toLowerCase()}</span>;
}
