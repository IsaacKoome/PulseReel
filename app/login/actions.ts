"use server";

import type { Route } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAuthEnabled } from "@/lib/auth/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function safeNextPath(value: FormDataEntryValue | null) {
  const nextPath = typeof value === "string" ? value : "/create";
  return nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/create";
}

export async function signInWithGoogle(formData: FormData) {
  if (!isAuthEnabled()) {
    redirect("/create");
  }

  const nextPath = safeNextPath(formData.get("next"));
  const headerStore = await headers();
  const origin = headerStore.get("origin") || `https://${headerStore.get("host")}`;
  const supabase = await createSupabaseServerClient();
  const callbackUrl = new URL("/auth/callback", origin);
  callbackUrl.searchParams.set("next", nextPath);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl.toString() },
  });

  if (error || !data.url) {
    redirect(`/login?error=${encodeURIComponent(error?.message || "Could not start sign in.")}`);
  }

  redirect(data.url as Route);
}
