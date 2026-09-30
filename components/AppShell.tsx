"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useLogout } from "@/lib/queries";
import type { Tenant, User } from "@/lib/types";

/** Plain text navigation. Two groups: the work, and what runs underneath it. */
const GROUPS: Array<{ label: string; items: Array<[href: string, label: string]> }> = [
  {
    label: "Decisions",
    items: [
      ["/dashboard", "Overview"],
      ["/decisions", "All decisions"],
      ["/at-risk", "Needs attention"],
      ["/approvals", "Reviews"],
      ["/documents", "Evidence"],
      ["/ask", "Find context"],
    ],
  },
  {
    label: "System",
    items: [
      ["/agents", "Agent sessions"],
      ["/triggers", "Triggers"],
      ["/inspector", "Memory inspector"],
      ["/projects", "Projects"],
      ["/system", "Health"],
      ["/audit", "Audit log"],
    ],
  },
];

export function AppShell({ user, tenant, children }: { user: User; tenant: Tenant | null; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();
  const [open, setOpen] = useState(false);

  async function onLogout() {
    try {
      await logout.mutateAsync();
      router.push("/login");
    } catch {
      /* The error is rendered below. */
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
        <button className="btn-secondary" aria-expanded={open} aria-controls="workspace-navigation" onClick={() => setOpen(!open)}>
          {open ? "Close" : "Menu"}
        </button>
      </header>
      {open && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setOpen(false)} />}
      <aside className={`workspace-sidebar ${open ? "is-open" : ""}`} id="workspace-navigation">
        <Link href="/dashboard" className="brand">
          DecisionLoop
        </Link>
        <p className="workspace-name" title={tenant?.name}>
          {tenant?.name ?? "Workspace"}
        </p>
        <Link href="/decisions/new" className="sidebar-new" onClick={() => setOpen(false)}>
          New decision
        </Link>
        <nav aria-label="Main">
          {GROUPS.map((group) => (
            <div key={group.label} className="nav-group">
              <p>{group.label}</p>
              {group.items.map(([href, label]) => {
                const active = pathname === href || pathname?.startsWith(`${href}/`);
                return (
                  <Link
                    href={href}
                    key={href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`nav-item ${active ? "active" : ""}`}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <strong>{user.name}</strong>
          <span className="block truncate">{user.email}</span>
          <button onClick={onLogout} disabled={logout.isPending} className="signout-button">
            Sign out
          </button>
          {logout.error && (
            <p role="alert" className="mt-1 text-risk-600">
              Sign out failed. Try again.
            </p>
          )}
        </div>
      </aside>
      <main id="workspace-content" className="workspace-main">
        <div className="workspace-content">{children}</div>
      </main>
    </div>
  );
}
