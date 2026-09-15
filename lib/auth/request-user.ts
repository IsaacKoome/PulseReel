import { createClient, type User } from "@supabase/supabase-js";
import { isAuthConfigured } from "@/lib/auth/config";
import { getCurrentUser } from "@/lib/auth/user";

export async function getRequestUser(request: Request): Promise<User | null> {
  const authorization = request.headers.get("authorization")?.trim();

  if (!authorization) {
    return getCurrentUser();
  }

  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;

  if (!isAuthConfigured()) {
    return null;
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  const { data, error } = await supabase.auth.getUser(token);

  return error ? null : data.user;
}
