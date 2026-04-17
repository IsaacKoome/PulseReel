import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectStatusPoller } from "@/components/project-status-poller";
import { getTemplateById } from "@/data/templates";
import { getProjectBySlug } from "@/lib/store";
import { formatCompactNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function WatchPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await getProjectBySlug(slug);

  if (!project) {
    notFound();
  }

  const template = getTemplateById(project.templateId);
  const modeLabel =
    project.renderMode === "heavy-worker-beta"
      ? "Heavy worker beta"
      : project.renderMode === "prompt-movie-beta"
        ? "Prompt movie beta"
        : "Fast trailer";
  const isProcessing = project.status === "processing" || project.status === "draft";
  const isFailed = project.status === "failed";

  return (
    <main className="watch-shell shell">
      <div className="topbar">
        <Link className="button-secondary" href="/">
          Home
        </Link>
        <strong>{project.title}</strong>
      </div>

      <div className="watch-grid">
        <section className="watch-card glass">
          <p className="eyebrow-copy">{template.name}</p>
          <h1 className="heading" style={{ marginBottom: 10 }}>
            {project.title}
          </h1>
          <p className="subtle">
            By {project.creatorName}. {project.caption}
          </p>

          <div className="watch-video" style={{ marginTop: 18 }}>
            {isProcessing ? (
              <img alt={`${project.title} poster`} src={project.posterUrl} />
            ) : (
              <video controls playsInline poster={project.posterUrl} src={project.processedVideoUrl} />
            )}
          </div>

          <div className="stats-row" style={{ marginTop: 18 }}>
            <div className="stats-box">
              <strong>{formatCompactNumber(project.metrics.plays)}</strong>
              Plays
            </div>
            <div className="stats-box">
              <strong>{formatCompactNumber(project.metrics.likes)}</strong>
              Likes
            </div>
            <div className="stats-box">
              <strong>{formatCompactNumber(project.metrics.shares)}</strong>
              Shares
            </div>
          </div>

          <div className="panel" style={{ marginTop: 18 }}>
            <div className="pill-row" style={{ marginBottom: 12 }}>
              <span className="pill">{project.genre}</span>
              <span className="pill">{template.runtimeLabel}</span>
              <span className="pill">
                {isFailed ? "Failed" : isProcessing ? "Processing" : "Published"}
              </span>
              <span className="pill">{modeLabel}</span>
            </div>
            <p className="body-copy" style={{ marginTop: 0 }}>
              {project.premise}
            </p>
          </div>

          {(isProcessing || isFailed) && (
            <ProjectStatusPoller
              initialStatus={{
                slug: project.slug,
                status: project.status,
                renderMode: project.renderMode,
                processedVideoUrl: project.processedVideoUrl,
                workerJob: project.workerJob,
              }}
              slug={project.slug}
            />
          )}
        </section>

        <section className="watch-card glass">
          <div className="poster-card">
            <img alt={`${project.title} poster`} src={project.posterUrl} />
          </div>

          <div className="panel" style={{ marginTop: 18 }}>
            <h3>Story Engine</h3>
            <p className="body-copy">
              Hook: {project.hook} Opening shot: {project.openingShot}
            </p>
          </div>

          <div className="panel" style={{ marginTop: 18 }}>
            <h3>Scene Prompts</h3>
            <div className="pill-row" style={{ marginTop: 12 }}>
              {project.scenePrompts.map((prompt) => (
                <span className="pill" key={prompt}>
                  {prompt}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="section" style={{ paddingTop: 20 }}>
        <div className="section-title">
          <div>
            <h2>Narrative Beats</h2>
            <p>The creator flow automatically expands the premise into a three-part short-film structure.</p>
          </div>
          <Link className="button" href="/create">
            Create Another
          </Link>
        </div>

        <div className="beat-grid">
          {project.beats.map((beat) => (
            <article className="beat" key={beat.heading}>
              <strong>{beat.heading}</strong>
              <p className="body-copy" style={{ margin: 0 }}>
                {beat.text}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <div>
            <h2>Shot Plan</h2>
            <p>The heavier beta pipeline breaks the prompt into shot-level direction before rendering the movie.</p>
          </div>
        </div>

        <div className="beat-grid">
          {project.shotPlan.map((shot) => (
            <article className="beat" key={shot.id}>
              <strong>
                {shot.label} · {shot.title}
              </strong>
              <p className="body-copy" style={{ margin: "0 0 10px" }}>
                {shot.prompt}
              </p>
              <p className="muted" style={{ margin: "0 0 6px" }}>
                {shot.composition}
              </p>
              {(shot.shotKind || shot.subjectFraming || shot.worldActivity) && (
                <div className="pill-row" style={{ margin: "0 0 10px" }}>
                  {shot.shotKind ? <span className="pill">Beat: {shot.shotKind}</span> : null}
                  {shot.subjectFraming ? <span className="pill">Frame: {shot.subjectFraming}</span> : null}
                  {shot.worldActivity ? <span className="pill">World: {shot.worldActivity}</span> : null}
                </div>
              )}
              <p className="muted" style={{ margin: 0 }}>
                {shot.motionHint} {shot.durationSeconds}s
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
