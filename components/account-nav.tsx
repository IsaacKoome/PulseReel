import type { User } from "@supabase/supabase-js";

export function AccountNav({
  enabled,
  user,
  compact = false,
  isAdmin = false,
}: {
  enabled: boolean;
  user: User | null;
  compact?: boolean;
  isAdmin?: boolean;
}) {
  if (!enabled) {
    return null;
  }

  if (!user) {
    return (
      <a className="button-secondary account-nav-link" href="/login">
        Sign in
      </a>
    );
  }

  const label =
    user.user_metadata?.full_name || user.user_metadata?.name || user.email || "Account";

  return (
    <nav className="account-nav" aria-label="Account">
      {isAdmin ? (
        <a className="button-secondary account-nav-link" href="/admin/beta">
          Beta Admin
        </a>
      ) : null}
      <a className="button-secondary account-nav-link" href="/movies">
        My Movies
      </a>
      {!compact ? <span className="account-name">{label}</span> : null}
      <form action="/auth/signout" method="post">
        <button className="account-signout" type="submit">
          Sign out
        </button>
      </form>
    </nav>
  );
}
