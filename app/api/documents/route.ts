import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { listDocuments } from "@/lib/repo/documents";

export async function GET() {
  try {
    const auth = await requireAuth();
    const documents = await listDocuments(auth.tenantId);
    return NextResponse.json({ documents });
  } catch (err) {
    return handleApiError(err);
  }
}
