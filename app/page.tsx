import Link from "next/link";
import { AccountNav } from "@/components/account-nav";
import { RecentMovies } from "@/components/recent-movies";
import { SiteFooter } from "@/components/site-footer";
import { isPulseReelAdmin } from "@/lib/auth/admin";
import { isAuthEnabled } from "@/lib/auth/config";
import { getCurrentUser } from "@/lib/auth/user";
import { getProjects } from "@/lib/store";

export const dynamic = "force-dynamic";

const demoVideo = "/mimiscene-kung-fu.mp4";

export default async function HomePage() {
  const authEnabled = isAuthEnabled();
  const user = await getCurrentUser();
  const projects = await getProjects();
  const featured = projects
    .filter((project) => project.visibility === "public" || (!project.visibility && !project.ownerId))
    .slice(0, 6)
    .map((project) => {
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
          MimiScene
        </Link>
        <div className="header-actions">
          <AccountNav enabled={authEnabled} user={user} compact isAdmin={isPulseReelAdmin(user)} />
          <Link className="button create-pill" href="/create">
            Create
          </Link>
        </div>
      </header>

      <section className="home-hero" aria-labelledby="home-hero-title">
        <div className="home-hero-copy">
          <p className="home-hero-kicker">YOUR PHOTO. YOUR STORY.</p>
          <h1 id="home-hero-title">Turn your photo into a movie scene <em>starring you.</em></h1>
          <p className="home-hero-description">Add a photo or short clip, describe the scene you imagine, and watch MimiScene bring it to life.</p>
          <div className="home-hero-actions">
            <Link className="button" href="/create">Create a scene <span aria-hidden="true">↗</span></Link>
            <Link className="button-secondary" href={{ pathname: "/upload" }}>Upload a video</Link>
            {process.env.NEXT_PUBLIC_GOOGLE_PLAY_LIVE === "true" ? (
              <a className="button-secondary" href="https://play.google.com/store/apps/details?id=com.mimireel.app">Get it on Google Play</a>
            ) : (
              <a className="button-secondary" href="#movies">Explore movies</a>
            )}
          </div>
        </div>
        <figure className="home-hero-demo">
          <video src={demoVideo} controls playsInline preload="metadata" aria-label="Isaac’s Kung Fu scene" />
          <figcaption><span>MIMISCENE DEMO</span><strong>Isaac’s Kung Fu Scene</strong></figcaption>
        </figure>
      </section>

      <section id="movies" className="home-feed" aria-label="Movies">
        <div className="home-feed-head">
          <div>
            <h2>Movies</h2>
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
      <SiteFooter />
    </main>
  );
}
