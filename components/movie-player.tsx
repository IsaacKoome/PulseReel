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
  title,
  posterUrl,
  videoUrl,
}: {
  title: string;
  posterUrl?: string;
  videoUrl?: string;
}) {
  const [hasPlaybackError, setHasPlaybackError] = useState(false);

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
        <a className="button" href={downloadUrl} download={`${title}.mp4`} target="_blank" rel="noreferrer">
          Download movie
        </a>
      </div>
    </div>
  );
}
