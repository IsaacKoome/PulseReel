"use client";

import { useState } from "react";

type Usage = {
  generatedAt: string;
  totals: Record<string, number>;
  estimatedCostUsd: { managed: number; creatorFunded: number };
  providerCounts: Record<string, number>;
};

type LaunchSettings = {
  launchMode: "creator-beta" | "original-mvp";
  managedDailyLimit: number;
  updatedAt: string;
};

export function CreatorBetaUsage() {
  const [adminKey, setAdminKey] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [settings, setSettings] = useState<LaunchSettings | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadUsage(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const headers = { "x-pulsereel-admin-key": adminKey };
      const [usageResponse, settingsResponse] = await Promise.all([
        fetch("/api/creator-beta/usage", { cache: "no-store", headers }),
        fetch("/api/creator-beta/settings", { cache: "no-store", headers }),
      ]);
      const usagePayload = (await usageResponse.json()) as Usage & { error?: string };
      const settingsPayload = (await settingsResponse.json()) as LaunchSettings & { error?: string };
      if (!usageResponse.ok) throw new Error(usagePayload.error || "Could not load usage.");
      if (!settingsResponse.ok) throw new Error(settingsPayload.error || "Could not load launch mode.");
      setUsage(usagePayload);
      setSettings(settingsPayload);
    } catch (error) {
      setUsage(null);
      setSettings(null);
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Could not load usage.");
    } finally {
      setLoading(false);
    }
  }

  async function saveLaunchMode(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/creator-beta/settings", {
        method: "PUT",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-pulsereel-admin-key": adminKey,
        },
        body: JSON.stringify({
          launchMode: settings.launchMode,
          managedDailyLimit: settings.managedDailyLimit,
        }),
      });
      const payload = (await response.json()) as LaunchSettings & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not switch launch mode.");
      setSettings(payload);
      setMessageTone("success");
      setMessage(
        payload.launchMode === "original-mvp"
          ? `Original MVP is live with a ${payload.managedDailyLimit}-generation daily cap.`
          : "Creator Beta is live. Creators fund their own Replicate generations.",
      );
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Could not switch launch mode.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="studio-card glass usage-dashboard">
      <form className="usage-auth-form" onSubmit={loadUsage}>
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

      {message ? <div className={`status ${messageTone === "error" ? "error" : ""}`}>{message}</div> : null}
      {settings ? (
        <form className="launch-mode-form" onSubmit={saveLaunchMode}>
          <div className="creator-beta-heading">
            <div>
              <span className="eyebrow">Launch mode</span>
              <h2>Choose the live PulseReel experience</h2>
            </div>
            <span className="beta-badge">Changes immediately</span>
          </div>
          <div className="funding-choice">
            <label className={`funding-option ${settings.launchMode === "creator-beta" ? "active" : ""}`}>
              <input
                checked={settings.launchMode === "creator-beta"}
                onChange={() => setSettings({ ...settings, launchMode: "creator-beta" })}
                type="radio"
              />
              <strong>Creator Beta</strong>
              <span>BYOK Replicate, access code required, private by default.</span>
            </label>
            <label className={`funding-option ${settings.launchMode === "original-mvp" ? "active" : ""}`}>
              <input
                checked={settings.launchMode === "original-mvp"}
                onChange={() => setSettings({ ...settings, launchMode: "original-mvp" })}
                type="radio"
              />
              <strong>Original MVP</strong>
              <span>PulseReel pays for Replicate. The public Create page has no beta gate.</span>
            </label>
          </div>
          <label className="label launch-limit-field">
            <span>Original MVP daily generation cap</span>
            <input
              className="input"
              max={50}
              min={1}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  managedDailyLimit: Math.max(1, Math.min(50, Number(event.target.value) || 1)),
                })
              }
              type="number"
              value={settings.managedDailyLimit}
            />
            <small className="creator-security-note">
              Every Original MVP generation uses PulseReel’s provider balance. The server blocks new starts after this cap.
            </small>
          </label>
          <button className="button" disabled={saving} type="submit">
            {saving ? "Switching…" : "Apply launch mode"}
          </button>
        </form>
      ) : null}

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
