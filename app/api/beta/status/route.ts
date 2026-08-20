import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/user";
import { getGenerationAccessStatus } from "@/lib/generation-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  const status = await getGenerationAccessStatus(user);
  return NextResponse.json(status, {
    headers: { "Cache-Control": "no-store" },
  });
}
