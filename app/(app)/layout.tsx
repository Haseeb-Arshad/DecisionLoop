import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getCurrentAuth } from "@/lib/auth/currentUser";
import { getTenantById } from "@/lib/repo/tenants";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await getCurrentAuth();
  if (!auth) redirect("/login");

  const tenant = await getTenantById(auth.tenantId);

  return (
    <AppShell user={auth.user} tenant={tenant}>
      {children}
    </AppShell>
  );
}
