"use client";

import { useState } from "react";
import Link from "next/link";

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

  return (
    <video
      controls
      playsInline
      poster={posterUrl}
      preload="metadata"
      src={videoUrl}
      onError={() => setHasPlaybackError(true)}
    >
      {title}
    </video>
  );
}
