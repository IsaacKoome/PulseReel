export function canDownloadMovie(movie: {
  status: string; visibility?: string; processedVideoUrl?: string; viewer?: { owns: boolean };
}) {
  return Boolean(movie.processedVideoUrl && movie.status === "published" &&
    (movie.visibility === "public" || movie.viewer?.owns));
}
