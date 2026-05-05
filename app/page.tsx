import Link from "next/link";
import { RecentMovies } from "@/components/recent-movies";
import { getProjects } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await getProjects();
  const featured = projects.slice(0, 6);

  return (
    <main className="app-home shell">
      <header className="app-header">
        <Link className="brand-mark" href="/">
          PulseReel
        </Link>
        <Link className="button create-pill" href="/create">
          Create
        </Link>
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
          <RecentMovies initialProjects={featured} />
        </div>
      </section>
    </main>
  );
}
