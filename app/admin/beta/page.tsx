import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isPulseReelAdmin } from "@/lib/auth/admin";
import { getCurrentUser } from "@/lib/auth/user";
import { getBetaAdminSnapshot } from "@/lib/generation-access";
import { setGenerationEnabled } from "./actions";

export const dynamic = "force-dynamic";

function shortId(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

export default async function BetaAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/beta");
  if (!isPulseReelAdmin(user)) notFound();

  const snapshot = await getBetaAdminSnapshot();

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
