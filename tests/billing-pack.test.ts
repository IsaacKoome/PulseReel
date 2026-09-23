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
  assert.match(page, /isLiveCheckoutReady/);
  assert.match(page, /Charged as/);
  const checkout = readFileSync(new URL("../app/billing/checkout.tsx", import.meta.url), "utf8");
  assert.match(checkout, /Purchases coming soon/);
  assert.match(checkout, /disabled=\{!ready \|\| busy\}/);
});

test("billing exposes customer history and safe payment rechecks", () => {
  const checkout = readFileSync(new URL("../app/billing/checkout.tsx", import.meta.url), "utf8");
  const billing = readFileSync(new URL("../lib/paystack-live.ts", import.meta.url), "utf8");
  assert.match(checkout, /Billing activity/);
  assert.match(checkout, /Recheck payment/);
  assert.match(checkout, /Not completed/);
  assert.match(billing, /paidOrderHistory/);
  assert.match(billing, /transaction\.status !== "success"/);
  assert.match(billing, /matchesLiveOrder\(transaction, order\)/);
});

test("mobile billing uses bearer auth and a safe app return page", () => {
  const route = readFileSync(new URL("../app/api/billing/route.ts", import.meta.url), "utf8");
  const billing = readFileSync(new URL("../lib/paystack-live.ts", import.meta.url), "utf8");
  const mobileReturn = readFileSync(new URL("../app/billing/mobile-return/page.tsx", import.meta.url), "utf8");

  assert.match(route, /getRequestUser\(request\)/);
  assert.match(route, /body\.client === "mobile"/);
  assert.match(billing, /"\/billing\/mobile-return"/);
  assert.match(mobileReturn, /verifyLivePayment\(reference\)/);
  assert.match(mobileReturn, /mimireel:\/\/billing/);
});

test("admin billing operations surface stale reservations without guessing refunds", () => {
  const admin = readFileSync(new URL("../app/admin/billing/page.tsx", import.meta.url), "utf8");
  const actions = readFileSync(new URL("../app/admin/billing/actions.ts", import.meta.url), "utf8");
  assert.match(admin, /staleReservations/);
  assert.match(admin, /Private payment operations/);
  assert.match(actions, /verifyLivePayment/);
  assert.match(actions, /reconcileDirectReplicateProject/);
  assert.match(actions, /provider has not supplied a final state yet/);
});
