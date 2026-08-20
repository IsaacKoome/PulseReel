import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/user";
import { trackBetaEvent } from "@/lib/generation-access";

const eventSchema = z.object({
  eventType: z.enum(["movie_downloaded", "movie_shared"]),
  projectId: z.string().min(1).max(160),
});

export async function POST(request: Request) {
  const parsed = eventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: true });
  }
  await trackBetaEvent({
    eventType: parsed.data.eventType,
    userId: user.id,
    projectId: parsed.data.projectId,
  });
  return NextResponse.json({ ok: true });
}
