import { NextRequest, NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { listDecisions } from "@/lib/repo/decisions";
import { listDocuments } from "@/lib/repo/documents";
import { getProjectById } from "@/lib/repo/projects";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const project = await getProjectById(auth.tenantId, id);
    if (!project) return jsonError("Project not found.", 404);

    const [decisions, documents] = await Promise.all([
      listDecisions(auth.tenantId, { projectId: id }),
      listDocuments(auth.tenantId, { projectId: id }),
    ]);

    return NextResponse.json({ project, decisions, documents });
  } catch (err) {
    return handleApiError(err);
  }
}
