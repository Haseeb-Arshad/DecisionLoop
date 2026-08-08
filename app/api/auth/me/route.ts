import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/handler";
import { getCurrentAuth } from "@/lib/auth/currentUser";
import { getTenantById } from "@/lib/repo/tenants";

export async function GET() {
  try {
    const auth = await getCurrentAuth();
    if (!auth) return NextResponse.json({ user: null, tenant: null });
    const tenant = await getTenantById(auth.tenantId);
    return NextResponse.json({ user: auth.user, tenant });
  } catch (err) {
    return handleApiError(err);
  }
}
