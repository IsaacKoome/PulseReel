import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/request-user";
import { getProjectBySlug } from "@/lib/store";
import { setMovieLike } from "@/lib/social";

export const dynamic = "force-dynamic";

async function changeLike(
  request: Request,
  params: Promise<{ slug: string }>,
  liked: boolean,
) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to like a movie." }, { status: 401 });
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (!project || project.visibility !== "public" || project.status !== "published") {
    return NextResponse.json({ error: "Movie not found." }, { status: 404 });
  }
  try {
    const result = await setMovieLike(project.id, user.id, liked);
    return NextResponse.json({
      liked: result.liked,
      likes: project.metrics.likes + result.recordedLikes,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The like could not be saved." },
      { status: 503 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return changeLike(request, params, true);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return changeLike(request, params, false);
}
