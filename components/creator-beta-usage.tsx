"use client";

import { useState } from "react";

type Usage = {
  generatedAt: string;
  totals: Record<string, number>;
  estimatedCostUsd: { managed: number; creatorFunded: number };
  providerCounts: Record<string, number>;
};

export function CreatorBetaUsage() {
  const [adminKey, setAdminKey] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadUsage(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/creator-beta/usage", {
        cache: "no-store",
        headers: { "x-pulsereel-admin-key": adminKey },
      });
      const payload = (await response.json()) as Usage & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load usage.");
      setUsage(payload);
    } catch (error) {
      setUsage(null);
      setMessage(error instanceof Error ? error.message : "Could not load usage.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="studio-card glass usage-dashboard">
      <form onSubmit={loadUsage}>
        <label className="label">
          <span>Creator Beta admin key</span>
          <input
            autoComplete="off"
            className="input secret-input"
            onChange={(event) => setAdminKey(event.target.value)}
            required
            type="password"
            value={adminKey}
          />
        </label>
        <button className="button" disabled={loading} type="submit">
          {loading ? "Loading…" : "View usage"}
        </button>
      </form>

      {message ? <div className="status error">{message}</div> : null}
      {usage ? (
        <div className="usage-results">
          <div className="stats-row">
            <article className="stat-card"><strong>{usage.totals.all}</strong><span>Total projects</span></article>
            <article className="stat-card"><strong>{usage.totals.managedToday}</strong><span>Managed today</span></article>
            <article className="stat-card"><strong>{usage.totals.failed}</strong><span>Failed</span></article>
          </div>
          <div className="grid-2">
            <article className="beat">
              <strong>Estimated PulseReel cost</strong>
              <p>${usage.estimatedCostUsd.managed.toFixed(2)}</p>
            </article>
            <article className="beat">
              <strong>Creator-funded volume</strong>
              <p>{usage.totals.creatorFunded} projects · ${usage.estimatedCostUsd.creatorFunded.toFixed(2)}</p>
            </article>
          </div>
          <article className="beat">
            <strong>Providers</strong>
            <p>
              {Object.entries(usage.providerCounts)
                .map(([provider, count]) => `${provider}: ${count}`)
                .join(" · ") || "No projects yet"}
            </p>
          </article>
          <small className="creator-security-note">
            Estimates use your configured unit costs. Replicate billing is the source of truth.
          </small>
        </div>
      ) : null}
    </section>
  );
}
