"use client";

import { useState, type ReactNode } from "react";

export function StoredMovieThumbnail({ url, priority, children }: {
  url?: string; priority: boolean; children: ReactNode;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  if (!url || failedUrl === url) return children;
  return <img src={url} alt="" className="movie-card-preview"
    loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"}
    decoding="async" onError={() => setFailedUrl(url)} />;
}
