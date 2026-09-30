import type { MemoryEvent, MemoryEventType } from "@/lib/types";

/**
 * A decision's history. Every row is a real `memory_events` record, so this
 * is an audit of what happened, not a story assembled from timestamps.
 * `flag` marks the events a person would want to notice when scanning.
 */
const EVENT_LABEL: Record<MemoryEventType, { label: string; flag?: "risk" | "warn" }> = {
  MEMORY_CREATED: { label: "Memory created" },
  MEMORY_RETRIEVED: { label: "Retrieved by an agent" },
  MEMORY_REFERENCED: { label: "Used in reasoning" },
  DECISION_COMMITTED: { label: "Decision committed" },
  EVIDENCE_ADDED: { label: "Evidence added" },
  ASSUMPTION_CHALLENGED: { label: "Assumption challenged", flag: "warn" },
  ASSUMPTION_INVALIDATED: { label: "Assumption invalidated", flag: "risk" },
  DECISION_AT_RISK: { label: "Decision marked at risk", flag: "risk" },
  DECISION_REOPENED: { label: "Decision reopened", flag: "warn" },
  DECISION_SUPERSEDED: { label: "Decision superseded" },
  CONFLICT_DISMISSED: { label: "Conflict dismissed" },
  CONFLICT_ACCEPTED: { label: "Evidence accepted" },
  DECISION_PROPOSED: { label: "Decision proposed" },
  DECISION_REJECTED: { label: "Proposal rejected" },
  ASSUMPTION_SUPPORTED: { label: "Evidence supports assumption" },
  ASSUMPTION_PROPOSED: { label: "Assumption proposed" },
  CONSTRAINT_VIOLATION_SUSPECTED: { label: "Possible constraint violation", flag: "warn" },
  APPROVAL_REQUESTED: { label: "Review requested", flag: "warn" },
  APPROVAL_RESOLVED: { label: "Review resolved" },
  CONTEXT_PROVIDED: { label: "Given to an agent as context" },
  OUTCOME_RECORDED: { label: "Outcome recorded" },
  VERIFICATION_CHECK_CONFIGURED: { label: "Verification workflow linked" },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const by = (t: MemoryEvent["actorType"]) => (t === "USER" ? "person" : t === "AGENT" ? "DecisionLoop" : "system");

export function MemoryTimeline({ events }: { events: MemoryEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-ink-500">Nothing has happened to this decision yet.</p>;

  return (
    <table className="w-full text-left text-sm">
      <thead className="sr-only">
        <tr>
          <th>When</th>
          <th>Event</th>
          <th>By</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => {
          const meta = EVENT_LABEL[event.eventType] ?? { label: event.eventType };
          return (
            <tr key={event.id} className="border-b border-ink-700/60 align-top last:border-0">
              <td className="w-36 whitespace-nowrap py-2 pr-3 text-xs text-ink-400">{when(event.createdAt)}</td>
              <td className="py-2 pr-3">
                <span className={meta.flag === "risk" ? "font-medium text-risk-600" : meta.flag === "warn" ? "font-medium text-amber-700" : "font-medium"}>
                  {meta.label}
                </span>
                {event.summary && <p className="mt-0.5 text-ink-400">{event.summary}</p>}
              </td>
              <td className="w-28 whitespace-nowrap py-2 text-xs text-ink-400">{by(event.actorType)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
