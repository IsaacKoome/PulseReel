import Link from "next/link";
import { AccountNav } from "@/components/account-nav";
import { RecentMovies } from "@/components/recent-movies";
import { isAuthEnabled } from "@/lib/auth/config";
import { getCurrentUser } from "@/lib/auth/user";
import { getProjects } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const authEnabled = isAuthEnabled();
  const user = await getCurrentUser();
  const projects = await getProjects();
  const featured = projects.slice(0, 6).map((project) => {
    const {
      deleteTokenHash: _deleteTokenHash,
      ownerId: _ownerId,
      ...publicProject
    } = project;
    return publicProject;
  });
  const accountOwnedSlugs = user
    ? projects.filter((project) => project.ownerId === user.id).map((project) => project.slug)
    : [];

  return (
    <main className="app-home shell">
      <header className="app-header">
        <Link className="brand-mark" href="/">
          PulseReel
        </Link>
        <div className="header-actions">
          <AccountNav enabled={authEnabled} user={user} compact />
          <Link className="button create-pill" href="/create">
            Create
          </Link>
        </div>
      </header>

      <section className="home-feed" aria-label="Movies">
        <div className="home-feed-head">
          <div>
            <h1>Movies</h1>
            <p>Turn a short clip into an AI movie scene.</p>
          </div>
          <Link className="button-secondary" href="/create">
            New Movie
          </Link>
        </div>

        <div className="feed-grid">
          <RecentMovies
            initialProjects={featured}
            accountOwnedSlugs={accountOwnedSlugs}
          />
        </div>
      </section>
    </main>
  );
}
