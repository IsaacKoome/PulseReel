import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { requireLiveKey, requireTestKey, validSignature, matchesLiveOrder, matchesOrder, TEST_PACK } from "../lib/paystack-validation.ts";

test("sandbox fails closed and rejects live keys", () => {
  assert.throws(() => requireTestKey(undefined));
  assert.throws(() => requireTestKey("sk_live_123456789012345"));
  assert.equal(requireTestKey("sk_test_123456789012345"), "sk_test_123456789012345");
  assert.equal(TEST_PACK.amount, 10000);
});
test("live billing fails closed and rejects test keys", () => {
  assert.throws(() => requireLiveKey(undefined));
  assert.throws(() => requireLiveKey("sk_test_123456789012345"));
  assert.equal(requireLiveKey("sk_live_123456789012345"), "sk_live_123456789012345");
});
test("webhooks require authentic raw-body signatures", () => {
  const key = "sk_test_123456789012345";
  const body = '{"event":"charge.success"}';
  const signature = createHmac("sha512", key).update(body).digest("hex");
  assert.equal(validSignature(body, signature, key), true);
  assert.equal(validSignature(body + " ", signature, key), false);
  assert.equal(validSignature(body, "bad", key), false);
  assert.equal(validSignature(body, null, key), false);
});
test("live verification requires the live domain and exact order", () => {
  const order = { reference: "live", amount: 67500, currency: "KES", email: "a@example.com" };
  const good = { ...order, domain: "live", status: "success", customer: { email: "A@example.com" } };
  assert.equal(matchesLiveOrder(good, order), true);
  assert.equal(matchesLiveOrder({ ...good, domain: "test" }, order), false);
  assert.equal(matchesLiveOrder({ ...good, amount: 10000 }, order), false);
});
test("verification checks domain, status, reference, amount, currency and customer", () => {
  const order = { reference: "test", amount: 10000, currency: "KES", email: "a@example.com" };
  const good = { ...order, domain: "test", status: "success", customer: { email: order.email } };
  assert.equal(matchesOrder(good, order), true);
  for (const patch of [{ domain: "live" }, { status: "pending" }, { reference: "other" },
    { amount: 1 }, { currency: "USD" }, { customer: { email: "other@example.com" } }]) {
    assert.equal(matchesOrder({ ...good, ...patch }, order), false);
  }
});
