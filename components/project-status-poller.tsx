"use client";

import { useEffect, useState } from "react";
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

  const summary =
    status.status === "failed"
      ? "Your movie could not be completed. Please return to the studio and try again."
      : status.status === "published"
        ? "Your movie is ready. Refreshing now."
        : "Your movie is being created. This page will update automatically.";

  return (
    <div className={`panel ${status.status === "failed" ? "status error" : ""}`} style={{ marginTop: 18 }}>
      <h3 style={{ marginTop: 0 }}>Movie Status</h3>
      <p className="body-copy" style={{ marginTop: 0 }}>
        {summary}
      </p>
      <div className="pill-row">
        <span className="pill">{status.status === "failed" ? "Not completed" : "In progress"}</span>
        {status.status !== "failed" ? (
          <span className="pill">{status.workerJob?.progress ?? 0}%</span>
        ) : null}
      </div>
    </div>
  );
}
