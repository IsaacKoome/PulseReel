import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pausePlayerSafely } from "../apps/mobile/src/lib/player-lifecycle.ts";
test("preview cleanup tolerates a native player already released on navigation", () => {
  let calls = 0;
  pausePlayerSafely({ pause() { calls++; } });
  assert.equal(calls, 1);
  assert.doesNotThrow(() => pausePlayerSafely({ pause() { throw new Error("Cannot use shared object that was already released"); } }));
  assert.throws(() => pausePlayerSafely({ pause() { throw new Error("Unexpected native error"); } }), /Unexpected native error/);
  const preview = readFileSync("apps/mobile/src/components/MoviePreview.tsx", "utf8");
  assert.match(preview, /pausePlayerSafely\(player\)/);
});
test("movie options support backdrop, Android back, and explicit Cancel", () => {
  const menu = readFileSync("apps/mobile/src/components/MovieOptions.tsx", "utf8");
  assert.match(menu, /onRequestClose=\{onClose\}/);
  assert.match(menu, /accessibilityLabel="Dismiss movie options" onPress=\{onClose\}/);
  const feed = readFileSync("apps/mobile/src/app/index.tsx", "utf8");
  assert.match(feed, /text: "Cancel"/);
  assert.match(feed, /setMovieOptions\(buttons\)/);
  assert.doesNotMatch(feed, /Alert.alert\("Movie options"/);
});
