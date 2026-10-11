import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canDownloadMovie } from "../apps/mobile/src/lib/media-policy.ts";
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
test("completed movie has native controls and actions outside the preview", () => {
  const movie = read("apps/mobile/src/app/movie/[slug].tsx");
  const preview = read("apps/mobile/src/components/MoviePreview.tsx");
  assert.match(preview, /nativeControls/);
  assert.match(preview, /contentFit="contain"/);
  assert.match(preview, /instance.loop = false/);
  assert.match(movie, /<MoviePreview uri=\{movie.processedVideoUrl\} \/>/);
  assert.match(movie, /Back to Watch/);
  assert.match(movie, /uses an available attempt/);
  assert.match(movie, /movie.visibility !== "public" && movie.viewer\?\.owns/);
});
test("uploaded videos use selectable frames without requiring a camera photo", () => {
  const creator = read("apps/mobile/src/app/create.tsx");
  const frame = read("apps/mobile/src/components/IdentityFramePicker.tsx");
  assert.match(creator, /setStage\(kind === "image" \? "describe" : "frame"\)/);
  assert.match(frame, /generateThumbnailsAsync\(player.currentTime/);
  assert.match(frame, /Choose a gallery photo instead/);
  assert.match(creator, /MAX_UPLOADED_IMAGE_BYTES = 25_000_000/);
});
test("library generates video thumbnails; downloads use files, not base64", () => {
  assert.match(read("apps/mobile/src/components/MovieThumbnail.tsx"), /generateThumbnailsAsync/);
  const download = read("apps/mobile/src/lib/download.ts");
  assert.match(download, /File.downloadFileAsync/);
  assert.match(download, /saveToLibraryAsync/);
  assert.match(download, /canDownloadMovie\(movie\)/);
  assert.doesNotMatch(download, /base64|arrayBuffer/);
});
test("download policy permits completed public movies and owner-only unpublished movies", () => {
  const ready = { status: "published", processedVideoUrl: "https://media.example/movie.mp4" };
  assert.equal(canDownloadMovie({ ...ready, visibility: "public" }), true);
  assert.equal(canDownloadMovie({ ...ready, visibility: "unlisted" }), false);
  assert.equal(canDownloadMovie({ ...ready, visibility: "unlisted", viewer: { owns: true } }), true);
  assert.equal(canDownloadMovie({ ...ready, visibility: "public", status: "processing" }), false);
  assert.equal(canDownloadMovie({ ...ready, visibility: "public", processedVideoUrl: undefined }), false);
});
