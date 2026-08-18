import { NextResponse, type NextRequest } from "next/server";
import { isAuthEnabled } from "@/lib/auth/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (isAuthEnabled()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }

  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
