"use client";

import { useEffect, useRef, useState } from "react";

export default function BillingCheckout({
  signedIn,
  ready,
  initialAttempts,
}: {
  signedIn: boolean;
  ready: boolean;
  initialAttempts: number;
}) {
  const [attempts, setAttempts] = useState(initialAttempts);
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
        setMessage("Payment verified. Your attempts are ready.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Billing request failed.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const reference = new URLSearchParams(window.location.search).get("reference");
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
    </div>
  );
}
