"use client";

import { useState } from "react";

export default function Checkout({ ready, initialCredits }: { ready: boolean; initialCredits: number }) {
  const [credits, setCredits] = useState(initialCredits);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(action: "initialize" | "verify") {
    setBusy(true); setMessage("");
    try {
      const reference = new URLSearchParams(window.location.search).get("reference");
      if (action === "verify" && !reference) throw new Error("Complete a test checkout first, then return here to verify.");
      const response = await fetch("/api/billing/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reference }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Request failed.");
      if (action === "initialize") window.location.assign(data.url);
      else { setCredits(data.credits); setMessage("Test payment verified. No real generation credits were added."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Request failed."); }
    finally { setBusy(false); }
  }
  return <section>
    <p>Verified test-credit balance: {credits}</p>
    <button type="button" className="button" disabled={!ready || busy} onClick={() => run("initialize")}>Start test checkout</button>{" "}
    <button type="button" className="button-secondary" disabled={!ready || busy} onClick={() => run("verify")}>Verify returned payment</button>
    <p role="status">{busy ? "Working…" : message}</p>
  </section>;
}
