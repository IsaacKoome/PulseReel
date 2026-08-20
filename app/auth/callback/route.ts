import { NextResponse, type NextRequest } from "next/server";
import { isAuthEnabled } from "@/lib/auth/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { trackBetaEvent } from "@/lib/generation-access";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next") || "/create";
  const nextPath =
    requestedNext.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/create";

  if (!isAuthEnabled()) {
    return NextResponse.redirect(new URL("/create", url.origin));
  }

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data } = await supabase.auth.getUser();
      await trackBetaEvent({ eventType: "sign_in_completed", userId: data.user?.id });
      return NextResponse.redirect(new URL(nextPath, url.origin));
    }
  }

  return NextResponse.redirect(new URL("/login?error=Sign-in%20could%20not%20be%20completed.", url.origin));
}
