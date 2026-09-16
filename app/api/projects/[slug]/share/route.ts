import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/request-user";
import { recordMovieShare } from "@/lib/social";
import { getProjectBySlug } from "@/lib/store";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ tracked: false });
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (!project || project.visibility !== "public" || project.status !== "published") {
    return NextResponse.json({ error: "Movie not found." }, { status: 404 });
  }
  try {
    const result = await recordMovieShare(project.id, user.id);
    return NextResponse.json({
      tracked: true,
      shares: project.metrics.shares + result.recordedShares,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The share could not be counted." },
      { status: 503 },
    );
  }
}
