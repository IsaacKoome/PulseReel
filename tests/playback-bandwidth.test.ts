import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("feed does not speculatively fetch the next movie", () => {
  const feed = readFileSync(new URL("../apps/mobile/src/app/index.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(feed, /preload=\{focused && index === activeIndex \+ 1\}/);
  assert.match(feed, /preload=\{false\}/);
});
test("web playback waits for user intent and native playback keeps caching", () => {
  const web = readFileSync(new URL("../components/movie-player.tsx", import.meta.url), "utf8");
  const mobile = readFileSync(new URL("../apps/mobile/src/components/MoviePlayer.tsx", import.meta.url), "utf8");
  assert.match(web, /preload="none"/);
  assert.match(mobile, /useCaching: true/);
  assert.match(mobile, /preferredForwardBufferDuration: 2/);
});
test("R2 output switch is explicit and keeps default Blob compatibility", () => {
  const storage = readFileSync(new URL("../lib/media-storage.ts", import.meta.url), "utf8");
  assert.match(storage, /MIMIREEL_MEDIA_STORAGE !== "r2"/);
  assert.match(storage, /return put\(/);
  assert.match(storage, /configuration is incomplete/);
  assert.match(storage, /client\.destroy\(\)/);
});
