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

test("web studio keeps creation to a clip and scene, with opt-in camera and optional settings", () => {
  const studio = readFileSync(new URL("../components/create-studio.tsx", import.meta.url), "utf8");

  assert.match(studio, /<h2 id="clip-heading">Your clip<\/h2>/);
  assert.match(studio, /<h2 id="story-heading">Your scene<\/h2>/);
  assert.match(studio, /<details className="mimi-advanced">/);
  assert.match(studio, /onClick=\{\(\) => void startCamera\(\)\}/);
  assert.doesNotMatch(studio, /void startCamera\(\);\s*return \(\) =>/);
  assert.match(studio, /setProjectVideo\(formData, finalVideo/);
});
