"use client";

import { useEffect, useRef, useState } from "react";
import type { PaidOrderSummary } from "@/lib/paystack-live";

export default function BillingCheckout({
  signedIn,
  ready,
  initialAttempts,
  initialOrders,
}: {
  signedIn: boolean;
  ready: boolean;
  initialAttempts: number;
  initialOrders: PaidOrderSummary[];
}) {
  const [attempts, setAttempts] = useState(initialAttempts);
  const [orders, setOrders] = useState(initialOrders);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const verifiedReference = useRef<string | null>(null);

  async function run(action: "initialize" | "verify", reference?: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reference }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Billing request failed.");
      if (action === "initialize") window.location.assign(data.url);
      else {
        setAttempts(data.attempts);
        setOrders((current) => current.map((order) =>
          order.reference === reference ? { ...order, paid: true } : order,
        ));
        setMessage("Payment verified. Your five attempts are ready to use.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Billing request failed.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const reference = parameters.get("reference") ?? parameters.get("trxref");
    if (!reference || verifiedReference.current === reference) return;
    verifiedReference.current = reference;
    void run("verify", reference);
  }, []);

  const buttonLabel = !signedIn
    ? "Sign in to purchase"
    : ready
      ? "Buy 5 attempts"
      : "Purchases coming soon";

  return (
    <div>
      {signedIn ? <p><strong>Available paid attempts: {attempts}</strong></p> : null}
      {!signedIn ? (
        <a className="button" href="/login">{buttonLabel}</a>
      ) : (
        <button
          className="button"
          type="button"
          disabled={!ready || busy}
          aria-describedby="billing-availability"
          onClick={() => run("initialize")}
        >
          {busy ? "Working…" : buttonLabel}
        </button>
      )}
      <p id="billing-availability">
        {ready
          ? "You will review the KES 675 charge in Paystack Checkout before paying."
          : "Payments are not open yet. No money can be charged from this page."}
      </p>
      <p role="status">{message}</p>
      {signedIn ? (
        <section style={{ marginTop: 28 }} aria-labelledby="billing-history-heading">
          <h3 id="billing-history-heading">Billing activity</h3>
          {orders.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr><th>Date</th><th>Pack</th><th>Amount</th><th>Status</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.reference}>
                      <td>{new Date(order.createdAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}</td>
                      <td>{order.attempts} attempts</td>
                      <td>{order.currency} {(order.amount / 100).toLocaleString("en-KE")}</td>
                      <td>
                        <span className={`reservation-status ${order.paid ? "completed" : "reserved"}`}>
                          {order.paid ? "Paid" : "Not completed"}
                        </span>
                      </td>
                      <td>
                        {order.paid ? "—" : (
                          <button
                            className="button-secondary"
                            type="button"
                            disabled={busy}
                            onClick={() => void run("verify", order.reference)}
                          >
                            Recheck payment
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No purchases yet.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
