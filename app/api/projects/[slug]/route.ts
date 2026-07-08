import { NextResponse } from "next/server";
import { deleteProjectBySlug } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const deleted = await deleteProjectBySlug(slug);

  if (!deleted) {
    return NextResponse.json({ error: "Movie not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
