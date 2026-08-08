"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLogout } from "@/lib/queries";
import type { Tenant, User } from "@/lib/types";

const NAV_ITEMS = [
  { href: "/decisions", label: "Decisions" },
  { href: "/documents", label: "Documents" },
  { href: "/inspector", label: "Memory Inspector" },
  { href: "/audit", label: "Audit log" },
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

  async function onLogout() {
    await logout.mutateAsync();
    router.push("/login");
  }

  return (
    <div className="min-h-screen">
      <div className="border-b border-ink-800 bg-ink-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <Link href="/decisions" className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-signal-500 text-xs font-bold text-ink-950">
                D
              </div>
              <span className="text-sm font-semibold">DecisionLoop</span>
            </Link>
            <nav className="hidden items-center gap-1 sm:flex">
              {NAV_ITEMS.map((item) => {
                const active = pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-md px-3 py-1.5 text-sm transition ${
                      active
                        ? "bg-ink-800 text-ink-50"
                        : "text-ink-300 hover:bg-ink-900 hover:text-ink-100"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium text-ink-200">{tenant?.name ?? "Workspace"}</p>
              <p className="text-[11px] text-ink-500">{user.email}</p>
            </div>
            <button onClick={onLogout} className="btn-secondary !px-3 !py-1.5 text-xs">
              Sign out
            </button>
          </div>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto px-4 pb-2 sm:hidden">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-md px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
    </div>
  );
}
