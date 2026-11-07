import type { MovieProject } from "./types.ts";

export const MAX_PUBLISHED_UPLOAD_BYTES = 100_000_000;
export function validateUploadedMovieSource(metadata: { pathname: string; contentType: string; size: number }, ownerId: string) {
  const prefix = `pulsereel/source/${ownerId}/`;
  const match = metadata.pathname.startsWith(prefix) && metadata.pathname.slice(prefix.length).match(/^([0-9a-f-]{36})\.mp4$/i);
  if (!match || metadata.contentType !== "video/mp4" || metadata.size <= 0 || metadata.size > MAX_PUBLISHED_UPLOAD_BYTES) {
    throw new Error("Choose your own uploaded MP4 video, no larger than 100 MB.");
  }
  return match[1];
}

export function uploadedMovie(input: { id: string; ownerId: string; creatorName: string; title: string; caption: string; videoUrl: string; thumbnailUrl: string; now?: string }): MovieProject {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id, slug: `upload-${input.id}`, ownerId: input.ownerId,
    creatorName: input.creatorName, title: input.title, caption: input.caption,
    origin: "uploaded", rightsConfirmedAt: now, templateId: "uploaded-video", genre: "Uploaded",
    premise: input.caption || input.title, scenePrompt: "", persona: "", renderMode: "uploaded-video",
    status: "published", visibility: "unlisted", createdAt: now, updatedAt: now,
    hook: "", openingShot: "", beats: [], shotPlan: [], scenePrompts: [],
    posterUrl: input.thumbnailUrl, thumbnailUrl: input.thumbnailUrl, thumbnailVideoUrl: input.videoUrl,
    processedVideoUrl: input.videoUrl, sourceVideoUrl: input.videoUrl,
    metrics: { plays: 0, likes: 0, shares: 0 },
  };
}
