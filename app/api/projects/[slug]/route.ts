import { NextResponse } from "next/server";
import { verifyProjectDeleteToken } from "@/lib/project-ownership";
import { deleteProjectBySlug, getProjectBySlug, updateProject } from "@/lib/store";
import { getRequestUser } from "@/lib/auth/request-user";

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

  const user = await getRequestUser(request);
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  const user = await getRequestUser(request);

  if (!project) {
    return NextResponse.json({ error: "Movie not found." }, { status: 404 });
  }

  if (!user || !project.ownerId || project.ownerId !== user.id) {
    return NextResponse.json({ error: "Only the movie owner can change its visibility." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { visibility?: unknown } | null;
  if (body?.visibility !== "public" && body?.visibility !== "unlisted") {
    return NextResponse.json({ error: "Choose public or unlisted visibility." }, { status: 400 });
  }

  if (body.visibility === "public" && project.status !== "published") {
    return NextResponse.json(
      { error: "A movie can be published after generation finishes." },
      { status: 409 },
    );
  }

  const updated = await updateProject(project.id, (current) => ({
    ...current,
    visibility: body.visibility as "public" | "unlisted",
    updatedAt: new Date().toISOString(),
  }));

  return NextResponse.json({
    project: updated
      ? Object.fromEntries(
          Object.entries(updated).filter(([key]) => key !== "ownerId" && key !== "deleteTokenHash"),
        )
      : null,
  });
}
