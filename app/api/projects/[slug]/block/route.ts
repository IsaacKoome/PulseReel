import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/request-user";
import { setUserBlocked } from "@/lib/safety";
import { getProjectBySlug } from "@/lib/store";

export const dynamic = "force-dynamic";

async function changeBlock(
  request: Request,
  params: Promise<{ slug: string }>,
  blocked: boolean,
) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to block a creator." }, { status: 401 });

  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (!project || !project.ownerId) {
    return NextResponse.json({ error: "Creator not found." }, { status: 404 });
  }
  if (project.ownerId === user.id) {
    return NextResponse.json({ error: "You cannot block your own account." }, { status: 400 });
  }

  try {
    const result = await setUserBlocked(user.id, project.ownerId, blocked);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The creator block could not be saved." },
      { status: 503 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return changeBlock(request, params, true);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return changeBlock(request, params, false);
}
