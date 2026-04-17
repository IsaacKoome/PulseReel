import Link from "next/link";
import { movieTemplates } from "@/data/templates";
import { getProjects } from "@/lib/store";
import { formatCompactNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

function gradientStyle(palette: string[]) {
  return {
    background: `linear-gradient(140deg, ${palette[0]}, ${palette[1]} 52%, ${palette[2]})`,
  };
}

export default async function HomePage() {
  const projects = await getProjects();
  const featured = projects.slice(0, 6);

  return (
    <main>
      <section className="hero shell">
        <div className="hero-grid">
          <div className="hero-card glass">
            <span className="eyebrow">Identity-First Movie Maker</span>
            <h1 className="display">Create the movie where you are the main character.</h1>
            <p className="lede">
              PulseReel turns the idea in your head into a guided short-form movie package. Capture yourself,
              choose a mood, shape the story, and publish a trailer-style result people can watch immediately.
            </p>
            <div className="cta-row">
              <Link className="button" href="/create">
                Start Creating
              </Link>
              <a className="button-secondary" href="#templates">
                Explore Templates
              </a>
            </div>

            <div className="meta-row">
              <div className="meta-box">
                <strong>Guided</strong>
                Blank prompts are replaced with cinematic templates and structured beats.
              </div>
              <div className="meta-box">
                <strong>Vertical</strong>
                Built for mobile-first capture, short runtime, and sharing velocity.
              </div>
              <div className="meta-box">
                <strong>Expandable</strong>
                The pipeline is ready for future face-swap, lip-sync, and voice modules.
              </div>
            </div>
          </div>

          <div className="panel hero-preview glass">
            <div>
              <span className="eyebrow">Live Product Direction</span>
              <h2 style={{ marginBottom: 10 }}>TikTok energy, movie identity, creator ownership.</h2>
              <p className="body-copy">
                This MVP follows the strongest recommendation from the research: focus on templated story
                creation and publishing first, then plug in heavier generative models once the product loop is
                proven.
              </p>
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
            <h2>Template System</h2>
            <p>
              The app leans into repeatable creator success: fast onboarding, strong emotional hooks, and
              enough structure to make the result feel intentional rather than random.
            </p>
          </div>
          <Link className="button-secondary" href="/create">
            Open Studio
          </Link>
        </div>

        <div className="template-grid">
          {movieTemplates.map((template) => (
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
                <h3>{template.tagline}</h3>
                <p className="body-copy">{template.hook}</p>
                <div className="pill-row">
                  {template.genres.map((genre) => (
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
            <h2>Freshly Published</h2>
            <p>
              Every finished project gets a public watch page, a generated poster, and structured story beats
              that make the output feel like a mini release rather than a raw upload.
            </p>
          </div>
        </div>

        <div className="feed-grid">
          {featured.length === 0 ? (
            <article className="feed-card glass" style={{ padding: 24 }}>
              <h3>No movies yet</h3>
              <p className="body-copy">
                Be the first creator to publish a short. The studio is ready with capture, templates, and
                processing.
              </p>
              <Link className="button" href="/create">
                Make The First One
              </Link>
            </article>
          ) : (
            featured.map((project) => {
              const template = movieTemplates.find((item) => item.id === project.templateId) ?? movieTemplates[0];
              return (
                <Link className="feed-card glass" href={`/watch/${project.slug}`} key={project.id}>
                  <div className="feed-art" style={gradientStyle(template.palette)}>
                    <div
                      style={{
                        position: "absolute",
                        inset: "auto 18px 18px",
                        zIndex: 2,
                      }}
                    >
                      <strong style={{ fontSize: "1.2rem" }}>{project.title}</strong>
                      <p className="muted" style={{ margin: "6px 0 0" }}>
                        {project.creatorName}
                      </p>
                    </div>
                  </div>
                  <div className="feed-copy">
                    <h3>{project.title}</h3>
                    <p>{project.caption}</p>
                    <div className="pill-row">
                      <span className="pill">{project.genre}</span>
                      <span className="pill">{formatCompactNumber(project.metrics.plays)} plays</span>
                      <span className="pill">{formatCompactNumber(project.metrics.shares)} shares</span>
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </section>

      <section className="shell footer-copy">
        Built as a zero-to-low-cost MVP inspired by the product direction in your two PDFs: guided capture,
        template-first creation, local processing, and public sharing first.
      </section>
    </main>
  );
}

