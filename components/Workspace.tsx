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

/** "just now", "5m ago", "3h ago", "2d ago", else the date. A helper, not inline, so rendering stays pure. */
function relativeTime(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

const currentTime = () => Date.now();

/** Relative time, with the exact time on hover. */
export function When({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <span className="text-ink-500">—</span>;
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()} className="whitespace-nowrap text-ink-400" suppressHydrationWarning>
      {relativeTime(iso, currentTime())}
    </time>
  );
}
