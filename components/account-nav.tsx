import Link from "next/link";
import type { User } from "@supabase/supabase-js";

export function AccountNav({
  enabled,
  user,
  compact = false,
}: {
  enabled: boolean;
  user: User | null;
  compact?: boolean;
}) {
  if (!enabled) {
    return null;
  }

  if (!user) {
    return (
      <Link className="button-secondary account-nav-link" href="/login">
        Sign in
      </Link>
    );
  }

  const label =
    user.user_metadata?.full_name || user.user_metadata?.name || user.email || "Account";

  return (
    <nav className="account-nav" aria-label="Account">
      <Link className="button-secondary account-nav-link" href="/movies">
        My Movies
      </Link>
      {!compact ? <span className="account-name">{label}</span> : null}
      <form action="/auth/signout" method="post">
        <button className="account-signout" type="submit">
          Sign out
        </button>
      </form>
    </nav>
  );
}
