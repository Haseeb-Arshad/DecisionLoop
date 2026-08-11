import type {
  AssumptionValidity,
  DecisionStatus,
  DocumentStatus,
  DocumentSourceType,
} from "@/lib/types";

const DECISION_STYLES: Record<DecisionStatus, string> = {
  DRAFT: "bg-ink-600/40 text-ink-200 ring-1 ring-inset ring-ink-500/40",
  ACTIVE: "bg-signal-500/15 text-signal-400 ring-1 ring-inset ring-signal-500/30",
  AT_RISK: "bg-risk-500/15 text-risk-400 ring-1 ring-inset ring-risk-500/40",
  REOPENED: "bg-amber-500/15 text-amber-400 ring-1 ring-inset ring-amber-500/40",
  SUPERSEDED: "bg-ink-600/40 text-ink-300 ring-1 ring-inset ring-ink-500/40",
  ARCHIVED: "bg-ink-700/40 text-ink-400 ring-1 ring-inset ring-ink-600/40",
};

const DECISION_LABELS: Record<DecisionStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  AT_RISK: "At risk",
  REOPENED: "Reopened",
  SUPERSEDED: "Superseded",
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

const VALIDITY_STYLES: Record<AssumptionValidity, string> = {
  VALID: "bg-signal-500/10 text-signal-400 ring-1 ring-inset ring-signal-500/25",
  UNCERTAIN: "bg-ink-600/40 text-ink-200 ring-1 ring-inset ring-ink-500/40",
  CHALLENGED: "bg-amber-500/15 text-amber-400 ring-1 ring-inset ring-amber-500/40",
  INVALIDATED: "bg-risk-500/10 text-risk-400 ring-1 ring-inset ring-risk-500/30",
  SUPERSEDED: "bg-ink-700/40 text-ink-400 ring-1 ring-inset ring-ink-600/40",
};

const VALIDITY_LABELS: Record<AssumptionValidity, string> = {
  VALID: "Valid",
  UNCERTAIN: "Uncertain",
  CHALLENGED: "Challenged",
  INVALIDATED: "Invalidated",
  SUPERSEDED: "Superseded",
};

export function AssumptionStatusBadge({ status }: { status: AssumptionValidity }) {
  return <span className={`pill ${VALIDITY_STYLES[status]}`}>{VALIDITY_LABELS[status]}</span>;
}

const DOCUMENT_STYLES: Record<DocumentStatus, string> = {
  UPLOADED: "bg-ink-600/40 text-ink-200 ring-1 ring-inset ring-ink-500/40",
  PROCESSING: "bg-ink-600/40 text-ink-200 ring-1 ring-inset ring-ink-500/40",
  PROCESSED: "bg-signal-500/15 text-signal-400 ring-1 ring-inset ring-signal-500/30",
  FAILED: "bg-risk-500/15 text-risk-400 ring-1 ring-inset ring-risk-500/40",
};

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span className={`pill ${DOCUMENT_STYLES[status]}`}>
      {status === "PROCESSING" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-300" />
      )}
      {status.toLowerCase()}
    </span>
  );
}

const SOURCE_LABELS: Record<DocumentSourceType, string> = {
  CONTRACT: "Contract",
  VENDOR_OFFICIAL: "Vendor official",
  INTERNAL_ANALYSIS: "Internal analysis",
  NEWS: "News",
  UNVERIFIED: "Unverified",
  OTHER: "Other",
};

/** Authority is what decides whether a document can invalidate an assumption
 * or merely challenge it, so it's shown wherever a source is shown. */
export function SourceTypeBadge({
  sourceType,
  authorityScore,
}: {
  sourceType: DocumentSourceType;
  authorityScore?: number;
}) {
  const strong = (authorityScore ?? 0.6) >= 0.75;
  return (
    <span
      className={`pill ${
        strong
          ? "bg-ink-700/60 text-ink-100 ring-1 ring-inset ring-ink-500/40"
          : "bg-ink-800/60 text-ink-400 ring-1 ring-inset ring-ink-600/40"
      }`}
      title={
        authorityScore === undefined
          ? undefined
          : `Authority ${authorityScore.toFixed(2)} — decides whether this source can invalidate an assumption or only challenge it.`
      }
    >
      {SOURCE_LABELS[sourceType]}
      {authorityScore !== undefined && (
        <span className="font-mono text-[10px] opacity-70">{authorityScore.toFixed(2)}</span>
      )}
    </span>
  );
}
