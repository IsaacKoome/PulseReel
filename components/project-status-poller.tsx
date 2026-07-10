"use client";

import { useEffect, useMemo, useState } from "react";
import type { HeavyRenderProviderId, RenderMode } from "@/lib/types";

type StatusPayload = {
  slug: string;
  status: "draft" | "processing" | "published" | "failed";
  renderMode: RenderMode;
  processedVideoUrl?: string;
  workerJob?: {
    id: string;
    provider: HeavyRenderProviderId;
    providerUsed?: HeavyRenderProviderId | string;
    model?: string;
    fallbackReason?: string;
    status: "queued" | "running" | "completed" | "failed";
    progress: number;
    stage: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
  };
};

export function ProjectStatusPoller({
  slug,
  initialStatus,
}: {
  slug: string;
  initialStatus: StatusPayload;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    if (status.status === "published" || status.status === "failed") {
      return;
    }

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/projects/${slug}/status`, { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as StatusPayload;
        setStatus(payload);

        if (payload.status === "published") {
          window.location.reload();
        }
      } catch {
        return;
      }
    }, 3500);

    return () => window.clearInterval(interval);
  }, [slug, status.status]);

  const summary = useMemo(() => {
    if (status.status === "failed") {
      return status.workerJob?.error || "Heavy generation failed before the movie could finish.";
    }

    if (status.status === "published") {
      return "Your movie is ready. Refreshing now.";
    }

    return status.workerJob?.stage || "Queued for generation.";
  }, [status]);

  const requestedProvider = status.workerJob?.provider ?? "local-heavy-v1";
  const usedProvider =
    status.workerJob?.providerUsed ??
    (status.status === "published" || status.workerJob?.status === "completed" ? requestedProvider : "pending");

  return (
    <div className={`panel ${status.status === "failed" ? "status error" : ""}`} style={{ marginTop: 18 }}>
      <h3 style={{ marginTop: 0 }}>Heavy Worker Status</h3>
      <p className="body-copy" style={{ marginTop: 0 }}>
        {summary}
      </p>
      <div className="pill-row">
        <span className="pill">Status: {status.status}</span>
        <span className="pill">Requested: {requestedProvider}</span>
        <span className="pill">Used: {usedProvider}</span>
        {status.workerJob?.model ? <span className="pill">Model: {status.workerJob.model}</span> : null}
        <span className="pill">Worker: {status.workerJob?.status ?? "queued"}</span>
        <span className="pill">Progress: {status.workerJob?.progress ?? 0}%</span>
      </div>
      {status.workerJob?.fallbackReason ? (
        <p className="muted" style={{ margin: "10px 0 0" }}>
          Fallback: {status.workerJob.fallbackReason}
        </p>
      ) : null}
      {hasMounted && status.workerJob?.startedAt ? (
        <p className="muted" style={{ margin: "10px 0 0" }}>
          Started: {new Date(status.workerJob.startedAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}
