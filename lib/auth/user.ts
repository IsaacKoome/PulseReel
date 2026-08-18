import type { User } from "@supabase/supabase-js";
import { isAuthEnabled } from "@/lib/auth/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getCurrentUser(): Promise<User | null> {
  if (!isAuthEnabled()) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    return null;
  }

  return data.user;
}
