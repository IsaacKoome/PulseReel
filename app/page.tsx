import Link from "next/link";
import { movieTemplates } from "@/data/templates";
import { getProjects } from "@/lib/store";
import { RecentMovies } from "@/components/recent-movies";

export const dynamic = "force-dynamic";

function gradientStyle(palette: string[]) {
  return {
    background: `linear-gradient(140deg, ${palette[0]}, ${palette[1]} 52%, ${palette[2]})`,
  };
}

export default async function HomePage() {
  const projects = await getProjects();
  const featured = projects.slice(0, 3);
  const primaryTemplates = movieTemplates.slice(0, 3);

  return (
    <main>
      <section className="hero shell">
        <div className="hero-grid landing-hero">
          <div className="hero-card glass">
            <span className="eyebrow">AI movie studio</span>
            <h1 className="display">Turn yourself into a movie scene.</h1>
            <p className="lede">
              Record or upload a short clip, describe the scene, and PulseReel builds a vertical movie around
              you.
            </p>
            <div className="cta-row">
              <Link className="button" href="/create">
                Create a Movie
              </Link>
            </div>

            <div className="simple-steps" aria-label="How PulseReel works">
              <span>1. Add your clip</span>
              <span>2. Type your idea</span>
              <span>3. Generate</span>
            </div>
          </div>

          <div className="panel hero-preview glass" aria-label="Example movie preview">
            <div className="preview-copy">
              <span className="eyebrow">Example</span>
              <h2>“I’m on an island with pirates and fishermen.”</h2>
            </div>

            <div className="phone-frame">
              <div className="phone-screen">
                <div className="phone-pill" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section shell" id="templates">
        <div className="section-title">
          <div>
            <h2>Pick a vibe</h2>
            <p>Start simple. The studio can guide the style for you.</p>
          </div>
          <Link className="button-secondary" href="/create">
            Open Studio
          </Link>
        </div>

        <div className="template-grid">
          {primaryTemplates.map((template) => (
            <article className="template-card glass" key={template.id}>
              <div className="template-art" style={gradientStyle(template.palette)}>
                <div
                  style={{
                    position: "absolute",
                    inset: "auto 18px 18px",
                    zIndex: 2,
                  }}
                >
                  <strong style={{ fontSize: "1.25rem" }}>{template.name}</strong>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    {template.runtimeLabel}
                  </p>
                </div>
              </div>
              <div>
                <div className="pill-row">
                  {template.genres.slice(0, 2).map((genre) => (
                    <span className="pill" key={genre}>
                      {genre}
                    </span>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section shell">
        <div className="section-title">
          <div>
            <h2>Recent movies</h2>
            <p>Finished movies appear here after publishing.</p>
          </div>
        </div>

        <div className="feed-grid">
          <RecentMovies initialProjects={featured} />
        </div>
      </section>
    </main>
  );
}
