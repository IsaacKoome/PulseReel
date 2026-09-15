import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isPulseReelAdmin } from "@/lib/auth/admin";
import { getCurrentUser } from "@/lib/auth/user";
import { getBillingAdminSnapshot } from "@/lib/paystack-live";
import { recheckPaidOrder, reconcilePaidGeneration } from "./actions";

export const dynamic = "force-dynamic";

function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-5)}` : value;
}

function kenyaTime(value: string) {
  return new Date(value).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" });
}

export default async function BillingAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/billing");
  if (!isPulseReelAdmin(user)) notFound();

  const [snapshot, parameters] = await Promise.all([
    getBillingAdminSnapshot(),
    searchParams,
  ]);

  return (
    <main className="admin-shell shell">
      <header className="app-header compact-header">
        <Link className="brand-mark" href="/">PulseReel</Link>
        <div className="header-actions">
          <Link className="button-secondary" href="/admin/beta">Beta Admin</Link>
          <Link className="button-secondary" href="/billing">Customer billing</Link>
          <Link className="button-secondary" href="/">Home</Link>
        </div>
      </header>

      <section className="admin-heading">
        <p className="eyebrow-copy">Private payment operations</p>
        <h1>Billing</h1>
        <p>Review live orders, attempt balances, ledger entries, and generation reservations.</p>
      </section>

      {parameters.notice ? (
        <div className="admin-warning" role="status"><strong>Reconciliation result</strong><span>{parameters.notice}</span></div>
      ) : null}
      {snapshot.staleReservations > 0 ? (
        <div className="admin-warning" role="alert">
          <strong>{snapshot.staleReservations} paid generation reservation{snapshot.staleReservations === 1 ? "" : "s"} need attention.</strong>
          <span>They have remained reserved for more than 30 minutes. Reconcile only from a confirmed project/provider state.</span>
        </div>
      ) : null}

      <section className="admin-stat-grid" aria-label="Paid billing totals">
        <div className="stats-box"><strong>KES {(snapshot.totalCollected / 100).toLocaleString("en-KE")}</strong>Verified revenue</div>
        <div className="stats-box"><strong>{snapshot.paidOrders}</strong>Paid orders</div>
        <div className="stats-box"><strong>{snapshot.incompleteOrders}</strong>Incomplete checkouts</div>
        <div className="stats-box"><strong>{snapshot.availableAttempts}</strong>Available attempts</div>
        <div className="stats-box"><strong>{snapshot.reservedAttempts}</strong>Reserved attempts</div>
        <div className="stats-box"><strong>{snapshot.staleReservations}</strong>Need reconciliation</div>
      </section>

      <section className="admin-table-card glass" style={{ marginBottom: 18 }}>
        <div className="admin-table-heading"><p className="eyebrow-copy">Latest 100</p><h2>Live payment orders</h2></div>
        {snapshot.recentOrders.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Status</th><th>Customer</th><th>Amount</th><th>Attempts</th><th>Reference</th><th>Created</th><th>Action</th></tr></thead>
              <tbody>
                {snapshot.recentOrders.map((order) => (
                  <tr key={order.reference}>
                    <td><span className={`reservation-status ${order.paid ? "completed" : "reserved"}`}>{order.paid ? "Paid" : "Incomplete"}</span></td>
                    <td>{order.email}</td>
                    <td>{order.currency} {(order.amount / 100).toLocaleString("en-KE")}</td>
                    <td>{order.attempts}</td>
                    <td title={order.reference}>{shortId(order.reference)}</td>
                    <td>{kenyaTime(order.createdAt)}</td>
                    <td>{order.paid ? "—" : (
                      <form action={recheckPaidOrder}>
                        <input name="reference" type="hidden" value={order.reference} />
                        <button className="button-secondary" type="submit">Recheck</button>
                      </form>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">No live payment orders yet.</p>}
      </section>

      <section className="admin-table-card glass" style={{ marginBottom: 18 }}>
        <div className="admin-table-heading"><p className="eyebrow-copy">Generation accounting</p><h2>Paid attempt reservations</h2></div>
        {snapshot.recentAttempts.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Status</th><th>User</th><th>Project</th><th>Reserved</th><th>Updated</th><th>Action</th></tr></thead>
              <tbody>
                {snapshot.recentAttempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <td><span className={`reservation-status ${attempt.status}`}>{attempt.stale ? "Needs attention" : attempt.status}</span></td>
                    <td title={attempt.userId}>{shortId(attempt.userId)}</td>
                    <td title={attempt.projectId ?? undefined}>{attempt.projectId ? shortId(attempt.projectId) : "—"}</td>
                    <td>{kenyaTime(attempt.createdAt)}</td>
                    <td>{kenyaTime(attempt.updatedAt)}</td>
                    <td>{attempt.status === "reserved" && attempt.projectId ? (
                      <form action={reconcilePaidGeneration}>
                        <input name="projectId" type="hidden" value={attempt.projectId} />
                        <button className="button-secondary" type="submit">Reconcile</button>
                      </form>
                    ) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">No paid attempts have been used yet.</p>}
      </section>

      <section className="admin-table-card glass">
        <div className="admin-table-heading"><p className="eyebrow-copy">Immutable audit trail</p><h2>Attempt ledger</h2></div>
        {snapshot.recentLedger.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Change</th><th>User</th><th>Event</th><th>Recorded</th></tr></thead>
              <tbody>
                {snapshot.recentLedger.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.delta > 0 ? `+${entry.delta}` : entry.delta}</td>
                    <td title={entry.userId}>{shortId(entry.userId)}</td>
                    <td title={entry.eventKey}>{shortId(entry.eventKey)}</td>
                    <td>{kenyaTime(entry.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">The ledger will populate after the first verified payment.</p>}
      </section>
    </main>
  );
}
