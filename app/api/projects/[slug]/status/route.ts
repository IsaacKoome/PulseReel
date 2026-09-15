import { NextResponse } from "next/server";
import { getProjectStatus } from "@/lib/heavy-worker";
import { getProjectBySlug } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _request: Request,
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
  return NextResponse.json(clientProject, {
    headers: { "Cache-Control": "no-store" },
  });
}
