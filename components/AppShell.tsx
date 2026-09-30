"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useLogout } from "@/lib/queries";
import { Icon } from "@/components/Workspace";
import type { Tenant, User } from "@/lib/types";
const GROUPS: Array<{ label: string; items: Array<[string, string, string]> }> =
  [
    {
      label: "Decision workspace",
      items: [
        ["/dashboard", "Overview", "overview"],
        ["/decisions", "Decision register", "decisions"],
        ["/at-risk", "Attention queue", "risk"],
        ["/approvals", "Human reviews", "approvals"],
        ["/documents", "Evidence", "evidence"],
        ["/ask", "Find context", "ask"],
      ],
    },
    {
      label: "Operations",
      items: [
        ["/agents", "Agent sessions", "agents"],
        ["/triggers", "Triggers", "triggers"],
        ["/inspector", "Memory inspector", "inspector"],
        ["/projects", "Projects", "projects"],
        ["/system", "System health", "system"],
        ["/audit", "Audit log", "decisions"],
      ],
    },
  ];
export function AppShell({
  user,
  tenant,
  children,
}: {
  user: User;
  tenant: Tenant | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  async function onLogout() {
    try {
      await logout.mutateAsync();
      router.push("/login");
    } catch {
      /* Mutation error is rendered below. */
    }
  }
  return (
    <div
      className="workspace-shell"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <a className="skip-link" href="#workspace-content">
        Skip to content
      </a>
      <header className="mobile-bar">
        <Link href="/dashboard" className="font-semibold">
          DecisionLoop
        </Link>
        <button
          className="btn-secondary"
          aria-expanded={open}
          aria-controls="workspace-navigation"
          onClick={() => setOpen(!open)}
        >
          {open ? "Close menu" : "Menu"}
        </button>
      </header>
      {open && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={`workspace-sidebar ${open ? "is-open" : ""}`}
        id="workspace-navigation"
      >
        <Link href="/dashboard" className="brand">
          <span className="brand-mark" aria-hidden="true">
            ↗
          </span>
          <span>
            DecisionLoop<small>Reasoning, remembered.</small>
          </span>
        </Link>
        <div className="workspace-name">
          <span className="workspace-avatar">
            {(tenant?.name ?? "W").slice(0, 1).toUpperCase()}
          </span>
          <div>
            <span>{tenant?.name ?? "Workspace"}</span>
            <small>Decision workspace</small>
          </div>
        </div>
        <nav aria-label="Main navigation">
          {GROUPS.map((group) => (
            <div key={group.label} className="nav-group">
              <p>{group.label}</p>
              {group.items.map(([href, label, icon]) => {
                const active =
                  href === "/decisions"
                    ? pathname?.startsWith(href)
                    : pathname === href || pathname?.startsWith(href + "/");
                return (
                  <Link
                    href={href}
                    key={href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`nav-item ${active ? "active" : ""}`}
                  >
                    <Icon name={icon} />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-avatar">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-ink-400">{user.email}</p>
          </div>
          <button
            title="Sign out"
            aria-label="Sign out"
            onClick={onLogout}
            disabled={logout.isPending}
            className="signout-button"
          >
            ↪
          </button>
        </div>
        {logout.error && (
          <p role="alert" className="px-5 pb-3 text-xs text-risk-600">
            Sign out failed. Try again.
          </p>
        )}
      </aside>
      <main id="workspace-content" className="workspace-main">
        <div className="workspace-topline">
          <span>
            Workspace /{" "}
            {GROUPS.flatMap((g) => g.items).find((i) =>
              pathname?.startsWith(i[0]),
            )?.[1] ?? "Decision"}
          </span>
          <Link href="/decisions/new">+ New decision</Link>
        </div>
        <div className="workspace-content">{children}</div>
        <footer className="workspace-bottomline">
          DecisionLoop <span>Human decisions. Traceable evidence.</span>
        </footer>
      </main>
    </div>
  );
}
