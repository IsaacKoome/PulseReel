import assert from "node:assert/strict";
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
