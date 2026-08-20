"use client";

import { useState } from "react";
import Link from "next/link";

function withDownloadFlag(videoUrl: string) {
  try {
    const url = new URL(videoUrl);
    url.searchParams.set("download", "1");
    return url.toString();
  } catch {
    const separator = videoUrl.includes("?") ? "&" : "?";
    return `${videoUrl}${separator}download=1`;
  }
}

export function MoviePlayer({
  projectId,
  title,
  posterUrl,
  videoUrl,
}: {
  projectId: string;
  title: string;
  posterUrl?: string;
  videoUrl?: string;
}) {
  const [hasPlaybackError, setHasPlaybackError] = useState(false);
  const [shareLabel, setShareLabel] = useState("Share movie");

  function recordEvent(eventType: "movie_downloaded" | "movie_shared") {
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType, projectId }),
      keepalive: true,
    }).catch(() => undefined);
  }

  async function shareMovie() {
    const shareData = { title: `${title} · PulseReel`, text: "Watch my PulseReel movie.", url: window.location.href };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(window.location.href);
        setShareLabel("Link copied");
        window.setTimeout(() => setShareLabel("Share movie"), 2200);
      }
      recordEvent("movie_shared");
    } catch {
      // Closing the native share sheet is not an application error.
    }
  }

  if (!videoUrl || hasPlaybackError) {
    return (
      <div className="video-unavailable">
        <strong>Movie file is not reachable.</strong>
        <p>
          This usually happens when an old laptop/tunnel-hosted video expired or the worker stopped before saving a
          playable file.
        </p>
        <Link className="button" href="/create">
          Make a fresh movie
        </Link>
      </div>
    );
  }

  const downloadUrl = withDownloadFlag(videoUrl);

  return (
    <div className="movie-player">
      <video
        controls
        playsInline
        poster={posterUrl}
        preload="auto"
        src={videoUrl}
        onError={() => setHasPlaybackError(true)}
      >
        {title}
      </video>
      <div className="movie-actions">
        <a className="button-secondary" href={videoUrl} target="_blank" rel="noreferrer">
          Open movie
        </a>
        <a
          className="button"
          href={downloadUrl}
          download={`${title}.mp4`}
          target="_blank"
          rel="noreferrer"
          onClick={() => recordEvent("movie_downloaded")}
        >
          Download movie
        </a>
        <button className="button-secondary" type="button" onClick={() => void shareMovie()}>
          {shareLabel}
        </button>
      </div>
    </div>
  );
}
