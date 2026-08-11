import type { MemoryEvent, MemoryEventType } from "@/lib/types";

/**
 * The decision timeline from §24. Every entry is a real `memory_events`
 * row — nothing here is reconstructed from timestamps on other tables, so
 * the timeline is a genuine audit of what happened to this decision's
 * memory rather than a plausible narrative.
 */

const EVENT_META: Record<
  MemoryEventType,
  { label: string; dot: string; emphasis?: boolean }
> = {
  MEMORY_CREATED: { label: "Memory created", dot: "bg-ink-500" },
  MEMORY_RETRIEVED: { label: "Memory retrieved by agent", dot: "bg-ink-500" },
  MEMORY_REFERENCED: { label: "Memory used in reasoning", dot: "bg-signal-500" },
  DECISION_COMMITTED: { label: "Decision committed", dot: "bg-signal-500", emphasis: true },
  EVIDENCE_ADDED: { label: "New evidence added", dot: "bg-ink-400" },
  ASSUMPTION_CHALLENGED: { label: "Assumption challenged", dot: "bg-amber-500", emphasis: true },
  ASSUMPTION_INVALIDATED: { label: "Assumption invalidated", dot: "bg-risk-500", emphasis: true },
  DECISION_AT_RISK: { label: "Decision moved to AT RISK", dot: "bg-risk-500", emphasis: true },
  DECISION_REOPENED: { label: "Decision reopened", dot: "bg-amber-400", emphasis: true },
  DECISION_SUPERSEDED: { label: "Decision superseded", dot: "bg-ink-400", emphasis: true },
  CONFLICT_DISMISSED: { label: "Conflict dismissed", dot: "bg-ink-400" },
  CONFLICT_ACCEPTED: { label: "New evidence accepted", dot: "bg-risk-400" },
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MemoryTimeline({ events }: { events: MemoryEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-ink-500">
        No memory events recorded for this decision yet.
      </p>
    );
  }

  return (
    <ol className="relative space-y-0">
      <div
        aria-hidden
        className="absolute bottom-2 left-[5px] top-2 w-px bg-ink-700/70"
      />
      {events.map((event) => {
        const meta = EVENT_META[event.eventType] ?? {
          label: event.eventType,
          dot: "bg-ink-500",
        };
        return (
          <li key={event.id} className="relative flex gap-4 py-2.5 pl-0">
            <span
              className={`relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-ink-900 ${meta.dot}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span
                  className={`text-sm ${
                    meta.emphasis ? "font-medium text-ink-100" : "text-ink-300"
                  }`}
                >
                  {meta.label}
                </span>
                <span className="text-[11px] text-ink-500">{formatWhen(event.createdAt)}</span>
                <span className="text-[11px] text-ink-600">
                  {event.actorType === "AGENT"
                    ? "· by DecisionLoop"
                    : event.actorType === "USER"
                      ? "· by a person"
                      : "· system"}
                </span>
              </div>
              {event.summary && (
                <p className="mt-0.5 text-sm leading-relaxed text-ink-400">{event.summary}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
