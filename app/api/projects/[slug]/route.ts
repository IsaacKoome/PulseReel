import { NextResponse } from "next/server";
import { verifyProjectDeleteToken } from "@/lib/project-ownership";
import { deleteProjectBySlug, getProjectBySlug } from "@/lib/store";
import { getCurrentUser } from "@/lib/auth/user";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const project = await getProjectBySlug(slug);

  if (!project) {
    return NextResponse.json({ error: "Movie not found." }, { status: 404 });
  }

  const user = await getCurrentUser();
  const accountOwner = Boolean(project.ownerId && user?.id === project.ownerId);
  const deleteToken = request.headers.get("x-pulsereel-delete-token")?.trim() ?? "";
  const legacyBrowserOwner = Boolean(
    !project.ownerId && verifyProjectDeleteToken(deleteToken, project.deleteTokenHash),
  );

  if (!accountOwner && !legacyBrowserOwner) {
    return NextResponse.json(
      { error: "Only the account or browser that created this movie can delete it." },
      { status: 403 },
    );
  }

  const deleted = await deleteProjectBySlug(slug);

  if (!deleted) {
    return NextResponse.json({ error: "Movie not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
