import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidCreatorAdminToken } from "@/lib/creator-beta";
import { getCreatorRuntimeSettings, saveCreatorRuntimeSettings } from "@/lib/creator-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  launchMode: z.enum(["creator-beta", "original-mvp"]),
  managedDailyLimit: z.number().int().min(1).max(50),
});

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...init?.headers, "Cache-Control": "no-store" },
  });
}

function authorized(request: Request) {
  return (
    Boolean(process.env.PULSEREEL_CREATOR_BETA_ADMIN_TOKEN?.trim()) &&
    isValidCreatorAdminToken(request.headers.get("x-pulsereel-admin-key"))
  );
}

export async function GET(request: Request) {
  if (!authorized(request)) return json({ error: "Invalid admin key." }, { status: 401 });
  return json(await getCreatorRuntimeSettings());
}

export async function PUT(request: Request) {
  if (!authorized(request)) return json({ error: "Invalid admin key." }, { status: 401 });

  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid launch settings." }, { status: 400 });
  }

  return json(await saveCreatorRuntimeSettings(parsed.data));
}
