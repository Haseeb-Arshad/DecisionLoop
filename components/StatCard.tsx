import Link from "next/link";

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
  href,
}: {
  label: string;
  value: string | number | null;
  hint?: string;
  tone?: "neutral" | "signal" | "risk" | "warn";
  href?: string;
}) {
  const toneClasses = {
    neutral: "text-ink-50",
    signal: "text-signal-400",
    risk: "text-risk-400",
    warn: "text-amber-400",
  }[tone];

  const body = (
    <div className="card h-full p-4 transition hover:border-ink-600">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${toneClasses}`}>
        {/* A metric with no data shows an em dash, never a fabricated 0 that
            reads as a real measurement (§32). */}
        {value === null || value === undefined ? "—" : value}
      </p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
