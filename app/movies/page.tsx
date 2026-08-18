import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountNav } from "@/components/account-nav";
import { RecentMovies } from "@/components/recent-movies";
import { isAuthEnabled } from "@/lib/auth/config";
import { getCurrentUser } from "@/lib/auth/user";
import { getProjects } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function MyMoviesPage() {
  const enabled = isAuthEnabled();
  if (!enabled) {
    redirect("/");
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/movies");
  }

  const projects = (await getProjects())
    .filter((project) => project.ownerId === user.id)
    .map((project) => {
      const {
        deleteTokenHash: _deleteTokenHash,
        ownerId: _ownerId,
        ...publicProject
      } = project;
      return publicProject;
    });
  const ownedMovieSlugs = projects.map((project) => project.slug);

  return (
    <main className="app-home shell">
      <header className="app-header">
        <Link className="brand-mark" href="/">
          PulseReel
        </Link>
        <AccountNav enabled={enabled} user={user} />
      </header>
      <section className="home-feed" aria-label="My movies">
        <div className="home-feed-head">
          <div>
            <h1>My Movies</h1>
            <p>Movies created while signed in to this account.</p>
          </div>
          <Link className="button" href="/create">
            New Movie
          </Link>
        </div>
        <div className="feed-grid">
          <RecentMovies
            initialProjects={projects}
            accountOwnedSlugs={ownedMovieSlugs}
            maxProjects={50}
            includeBrowserProjects={false}
          />
        </div>
      </section>
    </main>
  );
}
