import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestUser } from "@/lib/auth/request-user";
import { reportProject } from "@/lib/safety";
import { getProjectBySlug } from "@/lib/store";

export const dynamic = "force-dynamic";

const reportSchema = z.object({
  reason: z.enum([
    "inappropriate",
    "harassment",
    "sexual_content",
    "violence",
    "misleading",
    "other",
  ]).default("inappropriate"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to report a movie." }, { status: 401 });

  const parsed = reportSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a valid report reason." }, { status: 400 });
  }

  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (!project || project.visibility !== "public" || project.status !== "published") {
    return NextResponse.json({ error: "Movie not found." }, { status: 404 });
  }
  if (project.ownerId === user.id) {
    return NextResponse.json({ error: "You cannot report your own movie." }, { status: 400 });
  }

  try {
    await reportProject({
      reporterId: user.id,
      projectId: project.id,
      reportedUserId: project.ownerId,
      reason: parsed.data.reason,
    });
    return NextResponse.json({ reported: true }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The report could not be submitted." },
      { status: 503 },
    );
  }
}
