import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/user";
import { saveMovieFeedback } from "@/lib/movie-feedback";
import { getProjectBySlug } from "@/lib/store";

export const dynamic = "force-dynamic";

const feedbackSchema = z.object({
  identityRating: z.number().int().min(1).max(5),
  movieRating: z.number().int().min(1).max(5),
  willingnessToPay: z.enum(["yes", "maybe", "no"]),
  comment: z.string().trim().max(500).default(""),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to share feedback." }, { status: 401 });
  }

  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (!project) {
    return NextResponse.json({ error: "Movie not found." }, { status: 404 });
  }
  if (project.ownerId !== user.id) {
    return NextResponse.json({ error: "Only the movie owner can share feedback." }, { status: 403 });
  }
  if (project.status !== "published") {
    return NextResponse.json({ error: "Feedback opens after the movie is completed." }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid feedback request." }, { status: 400 });
  }

  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Complete all three feedback questions." }, { status: 400 });
  }

  try {
    const feedback = await saveMovieFeedback({
      projectId: project.id,
      userId: user.id,
      ...parsed.data,
    });
    return NextResponse.json({ feedback });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save feedback." },
      { status: 500 },
    );
  }
}
