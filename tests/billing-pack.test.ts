import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LAUNCH_PACK, launchPackPrice } from "../lib/billing-pack.ts";

test("launch pack charges Kenyan cents, not USD, for five attempts", () => {
  assert.equal(LAUNCH_PACK.amount, 67500);
  assert.equal(LAUNCH_PACK.currency, "KES");
  assert.equal(LAUNCH_PACK.attempts, 5);
  assert.equal(launchPackPrice(), "KES 675");
  assert.equal(LAUNCH_PACK.durationSeconds, 5);
  assert.equal(LAUNCH_PACK.resolution, "480p");
  assert.equal(LAUNCH_PACK.audio, true);
});

test("billing remains disabled and displays the actual checkout currency", () => {
  const page = readFileSync(new URL("../app/billing/page.tsx", import.meta.url), "utf8");
  assert.match(page, /type="button" disabled/);
  assert.match(page, /Charged as/);
  assert.match(page, /Purchases coming soon/);
  assert.doesNotMatch(page, /fetch\(|action=/);
});
