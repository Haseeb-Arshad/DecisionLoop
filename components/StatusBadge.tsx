import type { AssumptionValidity, DecisionStatus, DocumentStatus, DocumentSourceType } from "@/lib/types";

/**
 * Status is a small square and a word. Color is reserved for "a person should
 * look at this" (red, amber); everything else is neutral, so a list of mostly
 * healthy records reads as quiet.
 */
type Tone = "active" | "risk" | "warn" | "muted" | "plain";
const TONE: Record<Tone, string> = {
  active: "status status-active",
  risk: "status status-risk",
  warn: "status status-warn",
  muted: "status status-muted",
  plain: "status",
};

function Status({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span className={TONE[tone]} title={title}>
      {children}
    </span>
  );
}

const DECISION: Record<DecisionStatus, [Tone, string]> = {
  DRAFT: ["plain", "Draft"],
  ACTIVE: ["active", "Active"],
  AT_RISK: ["risk", "At risk"],
  REOPENED: ["warn", "Reopened"],
  SUPERSEDED: ["muted", "Superseded"],
  ARCHIVED: ["muted", "Archived"],
};

export function DecisionStatusBadge({ status }: { status: DecisionStatus }) {
  const [tone, label] = DECISION[status];
  return <Status tone={tone}>{label}</Status>;
}

const VALIDITY: Record<AssumptionValidity, [Tone, string]> = {
  VALID: ["active", "Valid"],
  UNCERTAIN: ["plain", "Uncertain"],
  CHALLENGED: ["warn", "Challenged"],
  INVALIDATED: ["risk", "Invalidated"],
  SUPERSEDED: ["muted", "Superseded"],
};

export function AssumptionStatusBadge({ status }: { status: AssumptionValidity }) {
  const [tone, label] = VALIDITY[status];
  return <Status tone={tone}>{label}</Status>;
}

const DOCUMENT: Record<DocumentStatus, [Tone, string]> = {
  UPLOADED: ["plain", "Uploaded"],
  PROCESSING: ["plain", "Processing"],
  PROCESSED: ["active", "Processed"],
  FAILED: ["risk", "Failed"],
};

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const [tone, label] = DOCUMENT[status];
  return <Status tone={tone}>{label}</Status>;
}

const SOURCE_LABELS: Record<DocumentSourceType, string> = {
  CONTRACT: "Contract",
  VENDOR_OFFICIAL: "Vendor official",
  INTERNAL_ANALYSIS: "Internal analysis",
  NEWS: "News",
  UNVERIFIED: "Unverified",
  OTHER: "Other",
};

/** Authority decides whether a source can invalidate an assumption or only challenge it, so it is shown wherever a source is. */
export function SourceTypeBadge({ sourceType, authorityScore }: { sourceType: DocumentSourceType; authorityScore?: number }) {
  return (
    <span
      className="whitespace-nowrap text-xs text-ink-300"
      title={
        authorityScore === undefined
          ? undefined
          : `Authority ${authorityScore.toFixed(2)}. Decides whether this source can invalidate an assumption or only challenge it.`
      }
    >
      {SOURCE_LABELS[sourceType]}
      {authorityScore !== undefined && <span className="ml-1.5 font-mono text-ink-500">{authorityScore.toFixed(2)}</span>}
    </span>
  );
}
