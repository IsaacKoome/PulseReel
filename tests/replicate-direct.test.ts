import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { portraitIdentityBuffer } from "../lib/identity-portrait.ts";
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

test("Seedance identity frame fills portrait without blurred padding", async () => {
  const width = 600;
  const height = 800;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    pixels.fill(Math.floor(y / 8) % 2 === 0 ? 255 : 0, y * width * 3, (y + 1) * width * 3);
  }
  const source = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const image = new File([new Uint8Array(source)], "portrait.png", { type: "image/png" });
  const output = await portraitIdentityBuffer(image);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 480);
  assert.equal(metadata.height, 832);

  const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
  const topValues = Array.from({ length: 64 }, (_, y) => data[(y * info.width + 240) * info.channels]);
  const mean = topValues.reduce((sum, value) => sum + value, 0) / topValues.length;
  const variance = topValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / topValues.length;
  assert.ok(variance > 2_500, "the top edge should contain sharp image detail, not a blurred fill");
});
