import Link from "next/link";
import { MovieFeedbackForm } from "@/components/movie-feedback-form";
import { MoviePlayer } from "@/components/movie-player";
import { ProjectStatusPoller } from "@/components/project-status-poller";
import { RecoveredWatchProject } from "@/components/recovered-watch-project";
import { getCurrentUser } from "@/lib/auth/user";
import { getMovieFeedback } from "@/lib/movie-feedback";
import { getProjectBySlug } from "@/lib/store";
import { formatCompactNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

function formatQualityPercent(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "Not available";
}

export default async function WatchPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await getProjectBySlug(slug);

  if (!project) {
    return <RecoveredWatchProject slug={slug} />;
  }

  const isProcessing = project.status === "processing" || project.status === "draft";
  const isFailed = project.status === "failed";
  const user = await getCurrentUser();
  const canLeaveFeedback = project.status === "published" && project.ownerId === user?.id;
  const initialFeedback = canLeaveFeedback && user
    ? await getMovieFeedback(project.id, user.id)
    : null;
  const qualityReport = project.workerJob?.qualityReport;

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
          <p className="eyebrow-copy">PulseReel movie</p>
          <h1 className="heading" style={{ marginBottom: 10 }}>
            {project.title}
          </h1>
          <p className="subtle">
            By {project.creatorName}. {project.caption}
          </p>

          <div className="watch-video" style={{ marginTop: 18 }}>
            {isProcessing ? (
              <div className="render-placeholder">
                <span className="eyebrow-copy">Rendering</span>
                <strong>{project.title}</strong>
                <p>Your movie is being finished by the worker. This page will refresh when it is ready.</p>
              </div>
            ) : (
              <MoviePlayer
                projectId={project.id}
                posterUrl={project.posterUrl}
                title={project.title}
                videoUrl={project.processedVideoUrl}
              />
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
              <span className="pill">
                {isFailed ? "Failed" : isProcessing ? "Processing" : "Published"}
              </span>
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

          {canLeaveFeedback ? (
            <>
              {qualityReport ? (
                <div className="panel" style={{ marginTop: 18 }}>
                  <div className="pill-row" style={{ marginBottom: 12 }}>
                    <span className="pill">Identity quality check</span>
                    <span className="pill">
                      {qualityReport.identity.status === "pass" ? "Passed" : "Review suggested"}
                    </span>
                  </div>
                  <p className="body-copy" style={{ marginTop: 0 }}>
                    Face readable in {formatQualityPercent(qualityReport.identity.faceDetectionRate)} of sampled
                    frames · identity consistency {formatQualityPercent(qualityReport.identity.score)} · output{" "}
                    {qualityReport.normalization.final.width}×{qualityReport.normalization.final.height}.
                  </p>
                  {qualityReport.identity.flags.length ? (
                    <ul className="body-copy">
                      {qualityReport.identity.flags.map((flag) => <li key={flag}>{flag}</li>)}
                    </ul>
                  ) : (
                    <p className="subtle">No severe automated identity or facial-stability warning was found.</p>
                  )}
                  <small className="subtle">
                    This automatic check is a screening signal, not a guarantee that the generated face is exact.
                  </small>
                </div>
              ) : null}
              <MovieFeedbackForm initialFeedback={initialFeedback} slug={project.slug} />
            </>
          ) : null}
        </section>

        <section className="watch-card glass">
          <div className="poster-card poster-fallback">
            <span>PulseReel Original</span>
            <strong>{project.title}</strong>
            <p>Identity-first AI movie</p>
          </div>

          <div className="panel" style={{ marginTop: 18 }}>
            <h3>Make your own movie</h3>
            <p className="body-copy">Turn a short clip into a cinematic scene starring you.</p>
            <Link className="button" href="/create">
              Create Another
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
