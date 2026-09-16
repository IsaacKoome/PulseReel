import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/request-user";
import { setCreatorFollow } from "@/lib/social";
import { getProjectBySlug } from "@/lib/store";

export const dynamic = "force-dynamic";

async function changeFollow(
  request: Request,
  params: Promise<{ slug: string }>,
  following: boolean,
) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to follow a creator." }, { status: 401 });
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (!project || !project.ownerId || project.visibility !== "public") {
    return NextResponse.json({ error: "Creator not found." }, { status: 404 });
  }
  if (project.ownerId === user.id) {
    return NextResponse.json({ error: "You already own this creator profile." }, { status: 400 });
  }
  try {
    return NextResponse.json(await setCreatorFollow(user.id, project.ownerId, following));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The follow could not be saved." },
      { status: 503 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return changeFollow(request, params, true);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return changeFollow(request, params, false);
}
