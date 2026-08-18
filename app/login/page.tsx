import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { isAuthEnabled } from "@/lib/auth/config";
import { getCurrentUser } from "@/lib/auth/user";
import { signInWithGoogle } from "@/app/login/actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  if (!isAuthEnabled()) {
    redirect("/create");
  }

  const params = await searchParams;
  const user = await getCurrentUser();
  const nextPath =
    params.next?.startsWith("/") && !params.next.startsWith("//")
      ? params.next
      : "/create";

  if (user) {
    redirect(nextPath as Route);
  }

  return (
    <main className="auth-shell shell">
      <Link className="brand-mark" href="/">
        PulseReel
      </Link>
      <section className="auth-card glass">
        <span className="eyebrow">Your movies, your account</span>
        <h1>See yourself in the story.</h1>
        <p>
          Sign in once to create movies, return to them later, and keep control of what
          you publish.
        </p>
        {params.error ? <p className="auth-error">{params.error}</p> : null}
        <form action={signInWithGoogle}>
          <input name="next" type="hidden" value={nextPath} />
          <button className="button google-signin" type="submit">
            Continue with Google
          </button>
        </form>
        <Link className="auth-back" href="/">
          Back to movies
        </Link>
      </section>
    </main>
  );
}
