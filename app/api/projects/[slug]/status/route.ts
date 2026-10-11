import { NextResponse } from "next/server";
import { getProjectStatus } from "@/lib/heavy-worker";
import { getProjectBySlug } from "@/lib/store";
import { getRequestUser } from "@/lib/auth/request-user";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const status = await getProjectStatus(slug);

  if (!status) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const project = await getProjectBySlug(slug);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const { ownerId: _ownerId, deleteTokenHash: _deleteTokenHash, ...clientProject } = project;
  const user = await getRequestUser(request);
  return NextResponse.json({ ...clientProject, creatorId: project.ownerId ?? null, viewer: { owns: Boolean(user && project.ownerId === user.id), liked: false, following: false } }, {
    headers: { "Cache-Control": "no-store" },
  });
}
