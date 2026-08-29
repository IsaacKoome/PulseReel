import assert from "node:assert/strict";
import test from "node:test";
import {
  FREE_BETA_MANAGED_PROVIDER,
  SEEDANCE_15_ESTIMATED_COST_USD,
} from "../lib/beta-config.ts";

test("Seedance 1.5 Pro is the recommended free-beta provider", () => {
  assert.equal(FREE_BETA_MANAGED_PROVIDER, "replicate-seedance-1.5-pro");
  assert.equal(SEEDANCE_15_ESTIMATED_COST_USD, 0.125);
});
