import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setProjectVideo } from "../lib/project-submission.ts";

function sourceVideo() {
  return new File(["video bytes"], "identity.mp4", { type: "video/mp4" });
}

test("direct upload sends only the Blob URL to the project API", () => {
  const video = sourceVideo();
  const formData = new FormData();
  formData.set("videoUpload", video);

  setProjectVideo(formData, video, "https://blob.example/source.mp4");

  assert.equal(formData.has("videoUpload"), false);
  assert.equal(formData.has("video"), false);
  assert.equal(formData.get("videoBlobUrl"), "https://blob.example/source.mp4");
});

test("legacy upload sends one canonical video field", () => {
  const video = sourceVideo();
  const formData = new FormData();
  formData.set("videoUpload", video);

  setProjectVideo(formData, video);

  assert.equal(formData.has("videoUpload"), false);
  assert.equal(formData.has("videoBlobUrl"), false);
  assert.equal(formData.get("video"), video);
});

test("mobile source uploads use short-lived signed URLs capped at 50 MB", () => {
  const route = readFileSync(new URL("../app/api/uploads/mobile/route.ts", import.meta.url), "utf8");
  const creator = readFileSync(new URL("../apps/mobile/src/app/create.tsx", import.meta.url), "utf8");

  assert.match(route, /MAX_SOURCE_VIDEO_BYTES = 50_000_000/);
  assert.match(route, /getRequestUser\(request\)/);
  assert.match(route, /operations: \["put"\]/);
  assert.match(route, /issueSignedToken/);
  assert.match(route, /presignUrl/);
  assert.match(route, /expectedPrefix/);
  assert.match(creator, /MAX_UPLOADED_VIDEO_BYTES = 50_000_000/);
  assert.doesNotMatch(creator, /videoMaxDuration/);
  assert.match(creator, /maxDuration: 10/);
});

test("mobile photo selection reaches direct Seedance without a fake video upload", () => {
  const creator = readFileSync(new URL("../apps/mobile/src/app/create.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../apps/mobile/src/lib/api.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/projects/route.ts", import.meta.url), "utf8");

  assert.match(creator, /mediaTypes: \["images", "videos"\]/);
  assert.match(creator, /stage === "capture" \? \(\s*<Pressable style=\{styles\.galleryButton\} onPress=\{pickMedia\}>/);
  assert.match(creator, /setIdentity\(kind === "image" \? selected : null\)/);
  assert.match(api, /input\.clip\.kind === "image"/);
  assert.match(api, /form\.append\("sourceType", "image"\)/);
  assert.match(route, /imageOnly && !useDirectSeedance/);
  assert.match(route, /const sourceVideoUrl = imageOnly\s*\? ""/);
});

test("mobile identity photos are JPEG encoded and capped before multipart upload", () => {
  const api = readFileSync(new URL("../apps/mobile/src/lib/api.ts", import.meta.url), "utf8");
  assert.match(api, /ImageManipulator\.manipulate\(asset\.uri\)/);
  assert.match(api, /format: SaveFormat\.JPEG/);
  assert.match(api, /file\.size <= 1_000_000/);
  assert.match(api, /form\.append\("selfie", await prepareIdentityPhoto\(input\.identity\)\)/);
  assert.match(api, /response\.status === 413/);
  assert.match(api, /response\.status === 504/);
});

test("web studio keeps creation to a clip and scene, with opt-in camera and optional settings", () => {
  const studio = readFileSync(new URL("../components/create-studio.tsx", import.meta.url), "utf8");

  assert.match(studio, /<h2 id="clip-heading">Your clip<\/h2>/);
  assert.match(studio, /<h2 id="story-heading">Your scene<\/h2>/);
  assert.match(studio, /<details className="mimi-advanced">/);
  assert.match(studio, /onClick=\{\(\) => void startCamera\(\)\}/);
  assert.doesNotMatch(studio, /void startCamera\(\);\s*return \(\) =>/);
  assert.match(studio, /setProjectVideo\(formData, finalVideo/);
});
