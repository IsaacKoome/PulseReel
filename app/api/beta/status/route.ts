import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/request-user";
import { getGenerationAccessStatus } from "@/lib/generation-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  const status = await getGenerationAccessStatus(user);
  return NextResponse.json(status, {
    headers: { "Cache-Control": "no-store" },
  });
}
