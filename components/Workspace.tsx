import Link from "next/link";
import type { ReactNode } from "react";

/** Title, one sentence of description, and the page's main action. */
export function PageHeader({
  title,
  description,
  action,
}: {
  /** Kept for callers that still pass it; the plain layout does not show it. */
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="min-w-0">
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
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
  children?: ReactNode;
  href?: string;
  action?: string;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {href && (
        <Link href={href} className="btn-secondary mt-3">
          {action}
        </Link>
      )}
    </div>
  );
}

/** Error with a retry, or a loading placeholder shaped like the content it stands in for. */
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
      <div role="alert" className="card p-4">
        <h3 className="text-sm">This view could not be loaded</h3>
        <p className="mt-1 text-sm text-risk-600">{error.message}</p>
        {retry && (
          <button className="btn-secondary mt-3" onClick={retry}>
            Try again
          </button>
        )}
      </div>
    );
  if (loading)
    return (
      <div role="status" aria-label="Loading" className="space-y-2">
        <div className="h-4 w-1/3 rounded bg-ink-800" />
        <div className="h-4 w-2/3 rounded bg-ink-800" />
        <div className="h-4 w-1/2 rounded bg-ink-800" />
      </div>
    );
  return null;
}

/** Relative time, with the exact time on hover. */
export function When({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <span className="text-ink-500">—</span>;
  const d = new Date(iso);
  const seconds = Math.round((Date.now() - d.getTime()) / 1000);
  const units: Array<[number, string]> = [
    [60, "s"],
    [3600, "m"],
    [86400, "h"],
    [604800, "d"],
  ];
  let text = d.toISOString().slice(0, 10);
  if (seconds < 60) text = "just now";
  else {
    for (let i = 1; i < units.length; i++) {
      if (seconds < units[i]![0]) {
        text = `${Math.floor(seconds / units[i - 1]![0])}${units[i - 1]![1]} ago`;
        break;
      }
    }
  }
  return (
    <time dateTime={iso} title={d.toLocaleString()} className="whitespace-nowrap text-ink-400">
      {text}
    </time>
  );
}
