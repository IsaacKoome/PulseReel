import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isPulseReelAdmin } from "@/lib/auth/admin";
import { getCurrentUser } from "@/lib/auth/user";
import { SEEDANCE_15_ESTIMATED_COST_USD } from "@/lib/beta-config";
import { getBetaAdminSnapshot, getBetaUserAllowances } from "@/lib/generation-access";
import { buildIdentityBenchmark } from "@/lib/identity-benchmark";
import { getFeedbackAdminSnapshot } from "@/lib/movie-feedback";
import { getProjects } from "@/lib/store";
import { setAttemptLimit, setGenerationEnabled, setUserAttemptLimit } from "./actions";

export const dynamic = "force-dynamic";

function shortId(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function formatRating(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}/5`;
}

function formatPercent(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export default async function BetaAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/beta");
  if (!isPulseReelAdmin(user)) notFound();

  const [snapshot, feedback, betaUsers, projects] = await Promise.all([
    getBetaAdminSnapshot(),
    getFeedbackAdminSnapshot(),
    getBetaUserAllowances(),
    getProjects(),
  ]);
  const identityBenchmark = buildIdentityBenchmark(projects, feedback.recentFeedback);
  const maximumBudget = snapshot.totalAttemptLimit * SEEDANCE_15_ESTIMATED_COST_USD;
  const remainingBudget = snapshot.remainingAttempts * SEEDANCE_15_ESTIMATED_COST_USD;

  return (
    <main className="admin-shell shell">
      <header className="app-header compact-header">
        <Link className="brand-mark" href="/">
          PulseReel
        </Link>
        <div className="header-actions">
          <Link className="button-secondary" href="/create">
            Studio
          </Link>
          <Link className="button-secondary" href="/movies">
            My Movies
          </Link>
        </div>
      </header>

      <section className="admin-heading">
        <p className="eyebrow-copy">Private launch controls</p>
        <h1>Free Beta</h1>
        <p>Monitor every hosted generation attempt and stop new spending instantly.</p>
      </section>

      {!snapshot.controlsEnabled ? (
        <div className="admin-warning">
          <strong>Launch enforcement is not active.</strong>
          <span>
            Add <code>PULSEREEL_LAUNCH_CONTROLS_ENABLED=true</code> in Vercel before inviting beta users.
          </span>
        </div>
      ) : null}

      <section className="admin-control-card glass">
        <div>
          <span className={`admin-state ${snapshot.generationEnabled ? "open" : "paused"}`}>
            {snapshot.generationEnabled ? "Generation open" : "Generation paused"}
          </span>
          <h2>{snapshot.generationEnabled ? "Free movies can be started" : "No new hosted movies can be started"}</h2>
          <p>Existing jobs can still finish. This switch only blocks new managed-provider reservations.</p>
        </div>
        <form action={setGenerationEnabled}>
          <input name="enabled" type="hidden" value={snapshot.generationEnabled ? "false" : "true"} />
          <button className={snapshot.generationEnabled ? "button-danger" : "button"} type="submit">
            {snapshot.generationEnabled ? "Pause generation" : "Resume generation"}
          </button>
        </form>
      </section>

      <section className="admin-stat-grid" aria-label="Beta totals">
        <div className="stats-box"><strong>{snapshot.totalAttemptCount}</strong>Attempts used</div>
        <div className="stats-box"><strong>{snapshot.remainingAttempts}</strong>Attempts remaining</div>
        <div className="stats-box"><strong>{snapshot.totalAttemptLimit}</strong>Attempt limit</div>
        <div className="stats-box"><strong>{snapshot.counts.completed}</strong>Completed</div>
        <div className="stats-box"><strong>{snapshot.counts.submitted + snapshot.counts.reserved}</strong>In progress</div>
        <div className="stats-box"><strong>{snapshot.counts.failed}</strong>Failed</div>
      </section>

      <section className="admin-budget-card glass">
        <div>
          <p className="eyebrow-copy">Seedance safety budget</p>
          <h2>Cap the free beta before resuming</h2>
          <p>
            At the current estimated price of ${SEEDANCE_15_ESTIMATED_COST_USD.toFixed(2)} per
            successful five-second movie, this limit represents at most ${maximumBudget.toFixed(2)} in
            Seedance generations. The remaining estimated exposure is ${remainingBudget.toFixed(2)}.
          </p>
          <small>MiniMax and Replicate Pro are excluded from the free hosted beta.</small>
        </div>
        <form action={setAttemptLimit} className="admin-limit-form">
          <label htmlFor="attemptLimit">Total attempt limit</label>
          <div>
            <input
              defaultValue={snapshot.totalAttemptLimit}
              id="attemptLimit"
              max="100"
              min={Math.max(1, snapshot.totalAttemptCount)}
              name="attemptLimit"
              required
              step="1"
              type="number"
            />
            <button className="button-secondary" type="submit">Save limit</button>
          </div>
        </form>
      </section>

      <section className="admin-table-card admin-user-limits-card glass">
        <div className="admin-table-heading">
          <div>
            <p className="eyebrow-copy">Individual allowances</p>
            <h2>Free movies per account</h2>
            <p className="muted">
              New accounts receive one free AI movie by default. Set a personal limit from 0 to
              10,000; the total beta attempt limit above remains the final spending cap.
            </p>
          </div>
        </div>
        {betaUsers.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table admin-user-limits-table">
              <thead>
                <tr><th>User</th><th>Used</th><th>Remaining</th><th>Personal limit</th><th>Last sign-in</th></tr>
              </thead>
              <tbody>
                {betaUsers.map((betaUser) => (
                  <tr key={betaUser.userId}>
                    <td>
                      <strong>{betaUser.email}</strong>
                      <small>{betaUser.displayName || shortId(betaUser.userId)}</small>
                    </td>
                    <td>{betaUser.attemptsUsed}</td>
                    <td>{betaUser.attemptsRemaining}</td>
                    <td>
                      <form action={setUserAttemptLimit} className="admin-user-limit-form">
                        <input name="userId" type="hidden" value={betaUser.userId} />
                        <input
                          aria-label={`Free movie limit for ${betaUser.email}`}
                          defaultValue={betaUser.freeMovieLimit}
                          max="10000"
                          min="0"
                          name="freeMovieLimit"
                          required
                          step="1"
                          type="number"
                        />
                        <button className="button-secondary" type="submit">Save</button>
                      </form>
                    </td>
                    <td>
                      {betaUser.lastSignInAt
                        ? new Date(betaUser.lastSignInAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })
                        : "Never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No signed-up beta users were found.</p>
        )}
      </section>

      <section className="admin-feedback-card glass">
        <div className="admin-table-heading">
          <p className="eyebrow-copy">Movie feedback</p>
          <h2>What beta users actually experienced</h2>
        </div>
        <div className="admin-stat-grid feedback-stat-grid" aria-label="Beta feedback totals">
          <div className="stats-box"><strong>{feedback.totalResponses}</strong>Responses</div>
          <div className="stats-box"><strong>{formatRating(feedback.averageIdentityRating)}</strong>Identity accuracy</div>
          <div className="stats-box"><strong>{formatRating(feedback.averageMovieRating)}</strong>Movie quality</div>
          <div className="stats-box"><strong>{feedback.willingToPayCount}</strong>Would pay</div>
          <div className="stats-box"><strong>{feedback.maybePayCount}</strong>Might pay</div>
        </div>
        {feedback.recentFeedback.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table feedback-table">
              <thead>
                <tr><th>Movie</th><th>Identity</th><th>Quality</th><th>Would pay</th><th>Comment</th><th>Submitted</th></tr>
              </thead>
              <tbody>
                {feedback.recentFeedback.map((item) => (
                  <tr key={item.id}>
                    <td title={item.projectId}>{shortId(item.projectId)}</td>
                    <td>{item.identityRating}/5</td>
                    <td>{item.movieRating}/5</td>
                    <td>{item.willingnessToPay === "no" ? "Not yet" : item.willingnessToPay}</td>
                    <td className="feedback-comment-cell">{item.comment || "—"}</td>
                    <td>{new Date(item.updatedAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Feedback will appear here after a movie owner answers the three questions.</p>
        )}
      </section>

      <section className="admin-table-card glass">
        <div className="admin-table-heading">
          <div>
            <p className="eyebrow-copy">Identity model benchmark</p>
            <h2>Compare before changing the recommended model</h2>
            <p className="muted">
              A recommendation becomes decision-ready after at least five quality-checked movies and five owner
              identity ratings for the same model. Automatic scores are screening signals, not identity guarantees.
            </p>
          </div>
        </div>
        {identityBenchmark.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Model</th><th>Samples</th><th>Automated identity</th><th>Face readable</th>
                  <th>Passed / review</th><th>Owner identity</th><th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {identityBenchmark.map((row) => (
                  <tr key={row.model}>
                    <td>{row.model}</td>
                    <td>{row.samples}</td>
                    <td>{formatPercent(row.averageAutomatedScore)}</td>
                    <td>{formatPercent(row.averageFaceDetectionRate)}</td>
                    <td>{row.passingSamples} / {row.reviewSamples}</td>
                    <td>
                      {row.averageUserIdentityRating === null
                        ? "—"
                        : `${row.averageUserIdentityRating.toFixed(1)}/5 (${row.userRatings})`}
                    </td>
                    <td>{row.readyForRecommendationDecision ? "Ready to compare" : "Collect more samples"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">New quality-checked movies will populate this benchmark automatically.</p>
        )}
      </section>

      <section className="admin-table-card glass">
        <div className="admin-table-heading">
          <div>
            <p className="eyebrow-copy">Latest 50</p>
            <h2>Generation attempts</h2>
          </div>
        </div>
        {snapshot.recentReservations.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>Status</th><th>User</th><th>Provider</th><th>Project</th><th>Started</th></tr>
              </thead>
              <tbody>
                {snapshot.recentReservations.map((reservation) => (
                  <tr key={reservation.id}>
                    <td><span className={`reservation-status ${reservation.status}`}>{reservation.status}</span></td>
                    <td title={reservation.userId}>{shortId(reservation.userId)}</td>
                    <td>{reservation.provider}</td>
                    <td>{reservation.projectId ? shortId(reservation.projectId) : "—"}</td>
                    <td>{new Date(reservation.createdAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No beta attempts have been recorded yet.</p>
        )}
      </section>
    </main>
  );
}
