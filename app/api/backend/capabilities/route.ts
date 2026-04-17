import { NextResponse } from "next/server";
import { getBackendCapabilities } from "@/lib/backend-capabilities";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getBackendCapabilities());
}
