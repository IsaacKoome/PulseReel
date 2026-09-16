import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestUser } from "@/lib/auth/request-user";
import { addMovieComment, listMovieComments } from "@/lib/social";
import { getProjectBySlug } from "@/lib/store";

export const dynamic = "force-dynamic";

const commentSchema = z.object({ body: z.string().trim().min(1).max(500) });

function displayName(user: { email?: string; user_metadata?: Record<string, unknown> }) {
  const metadataName = user.user_metadata?.full_name || user.user_metadata?.name;
  if (typeof metadataName === "string" && metadataName.trim()) return metadataName.trim().slice(0, 80);
  return (user.email?.split("@")[0] || "Creator").slice(0, 80);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (!project || project.visibility !== "public" || project.status !== "published") {
    return NextResponse.json({ error: "Movie not found." }, { status: 404 });
  }
  try {
    const comments = await listMovieComments(project.id);
    return NextResponse.json(
      { comments, count: comments.length },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Comments could not be loaded." },
      { status: 503 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to join the conversation." }, { status: 401 });
  const parsed = commentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Write between 1 and 500 characters." }, { status: 400 });
  }
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (!project || project.visibility !== "public" || project.status !== "published") {
    return NextResponse.json({ error: "Movie not found." }, { status: 404 });
  }
  try {
    const comment = await addMovieComment({
      projectId: project.id,
      userId: user.id,
      authorName: displayName(user),
      body: parsed.data.body,
    });
    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The comment could not be posted." },
      { status: 503 },
    );
  }
}
