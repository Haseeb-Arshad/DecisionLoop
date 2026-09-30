import Link from "next/link";

/** One figure with its label. A missing value is a dash, never a made-up zero. */
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
  const color = { neutral: "", signal: "", risk: "text-risk-600", warn: "text-amber-700" }[tone];
  const body = (
    <>
      <p>{label}</p>
      <strong className={color}>{value === null || value === undefined ? "—" : value}</strong>
      {hint && <small>{hint}</small>}
    </>
  );
  return href ? (
    <Link href={href} className="metric-cell block">
      {body}
    </Link>
  ) : (
    <div className="metric-cell">{body}</div>
  );
}
