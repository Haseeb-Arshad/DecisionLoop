import Link from "next/link";
import type { ReactNode } from "react";
export function PageHeader({
  eyebrow = "Workspace",
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
export function EmptyState({
  title,
  children,
  href,
  action,
}: {
  title: string;
  children: ReactNode;
  href?: string;
  action?: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-mark" aria-hidden="true">
        ↗
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {href && (
        <Link href={href} className="btn-primary mt-5">
          {action}
        </Link>
      )}
    </div>
  );
}
export function QueryState({
  loading,
  error,
  retry,
}: {
  loading?: boolean;
  error?: Error | null;
  retry?: () => unknown;
}) {
  if (error)
    return (
      <div role="alert" className="card p-6">
        <h3 className="font-semibold">Unable to load this view</h3>
        <p className="mt-2 text-sm text-risk-600">{error.message}</p>
        {retry && (
          <button className="btn-secondary mt-4" onClick={retry}>
            Try again
          </button>
        )}
      </div>
    );
  if (loading)
    return (
      <div
        role="status"
        aria-label="Loading workspace"
        className="card space-y-4 p-8 animate-pulse"
      >
        <div className="h-5 w-1/3 rounded bg-ink-800" />
        <div className="h-4 w-2/3 rounded bg-ink-800" />
        <div className="h-4 w-1/2 rounded bg-ink-800" />
      </div>
    );
  return null;
}
export function Icon({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  const paths: Record<string, string> = {
    overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    decisions: "M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h4",
    risk: "M12 3 2 21h20L12 3z M12 9v5 M12 17v.5",
    approvals: "M9 12l2 2 5-5 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    evidence: "M4 5h16v15H4z M8 9h8 M8 13h5 M8 17h8",
    ask: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14 M15 15l6 6",
    agents: "M7 7h10v10H7z M12 2v5 M12 17v5 M2 12h5 M17 12h5 M10 10v4 M14 10v4",
    system: "M4 4h16v6H4z M4 14h16v6H4z M7 7h.5 M7 17h.5",
    triggers: "M13 2 4 14h7l-1 8 10-13h-7l0-7z",
    inspector: "M3 12h4l3-8 4 16 3-8h4",
    projects: "M3 6h7l2 2h9v12H3V6z",
  };
  return (
    <svg
      className={className}
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.decisions} />
    </svg>
  );
}
