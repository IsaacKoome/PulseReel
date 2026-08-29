import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDirectSeedanceInput,
  buildDirectSeedancePrompt,
  findReplicateOutputUrl,
} from "../lib/replicate-direct-input.ts";

const project = {
  creatorName: "Isaac",
  premise: "Isaac walks through a rain-soaked futuristic city.",
  scenePrompt: "A cinematic tracking shot follows Isaac through neon streets.",
  persona: "curious traveler",
  cameraMode: "cinematic" as const,
};

test("direct Seedance input keeps the low-cost portrait audio profile", () => {
  const input = buildDirectSeedanceInput(project, "https://blob.example/identity.jpg");
  assert.equal(input.duration, 5);
  assert.equal(input.resolution, "480p");
  assert.equal(input.aspect_ratio, "9:16");
  assert.equal(input.fps, 24);
  assert.equal(input.generate_audio, true);
  assert.equal(input.image, "https://blob.example/identity.jpg");
});

test("direct Seedance prompt preserves cinematic identity instructions", () => {
  const prompt = buildDirectSeedancePrompt(project).toLowerCase();
  assert.match(prompt, /identity lock/);
  assert.match(prompt, /not a selfie/);
  assert.match(prompt, /natural eye proportions/);
  assert.match(prompt, /one coherent shot/);
});

test("Replicate output URL is recovered from nested output shapes", () => {
  assert.equal(
    findReplicateOutputUrl({ files: [{ url: "https://replicate.delivery/movie.mp4" }] }),
    "https://replicate.delivery/movie.mp4",
  );
});
