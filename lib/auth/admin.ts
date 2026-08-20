import type { User } from "@supabase/supabase-js";

function adminEmails() {
  return (process.env.PULSEREEL_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isPulseReelAdmin(user: User | null) {
  const email = user?.email?.trim().toLowerCase();
  return Boolean(email && adminEmails().includes(email));
}
