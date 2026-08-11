import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { recordAuditEvent } from "@/lib/repo/auditEvents";
import { createProject, listProjects } from "@/lib/repo/projects";

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
});

export async function GET() {
  try {
    const auth = await requireAuth();
    const projects = await listProjects(auth.tenantId);
    return NextResponse.json({ projects });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = CreateProjectSchema.parse(await req.json());

    const project = await createProject({
      tenantId: auth.tenantId,
      name: body.name,
      description: body.description ?? null,
      createdBy: auth.user.id,
    });

    await recordAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.user.id,
      action: "project.created",
      entityType: "project",
      entityId: project.id,
      metadata: { name: project.name },
    });

    return NextResponse.json({ project });
  } catch (err) {
    return handleApiError(err);
  }
}
