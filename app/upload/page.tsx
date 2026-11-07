import Link from "next/link";
import { redirect } from "next/navigation";
import { UploadMovieForm } from "@/components/upload-movie-form";
import { isAuthEnabled } from "@/lib/auth/config";
import { getCurrentUser } from "@/lib/auth/user";

export default async function UploadPage() {
  const user = await getCurrentUser();
  if (!user && isAuthEnabled()) redirect("/login?next=/upload");
  return (
    <main className="watch-shell shell">
      <Link className="brand-mark" href="/">MimiScene</Link>
      <section className="auth-card glass">
        <h1>Upload a video</h1>
        <p>Share a finished MP4 up to 100 MB. No AI generation or credits are used.</p>
        {user ? <UploadMovieForm ownerId={user.id} /> : <p>Sign-in must be configured to upload videos.</p>}
      </section>
    </main>
  );
}
