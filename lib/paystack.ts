import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { matchesOrder, requireTestKey, TEST_PACK } from "@/lib/paystack-validation";

export function sandboxKey() {
  if (process.env.PULSEREEL_PAYSTACK_TEST_ENABLED !== "true") throw new Error("Payment sandbox is disabled.");
  return requireTestKey(process.env.PAYSTACK_TEST_SECRET_KEY?.trim());
}

async function paystack(path: string, body?: Record<string, unknown>) {
  const response = await fetch(`https://api.paystack.co${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${sandboxKey()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok || result.status !== true || !result.data) throw new Error("Paystack request failed. Please retry later.");
  return result.data;
}

export function paymentOrigin() {
  const url = new URL(process.env.PULSEREEL_PAYMENT_ORIGIN ?? "");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) {
    throw new Error("Configure a secure payment origin.");
  }
  return url.origin;
}

export async function initializeTestPayment(userId: string, email: string) {
  sandboxKey();
  const origin = paymentOrigin();
  const reference = `pr-test-${randomUUID()}`;
  const db = createSupabaseAdminClient();
  const { error } = await db.from("pulse_reel_test_orders").insert({
    reference, user_id: userId, email, amount: TEST_PACK.amount,
    currency: TEST_PACK.currency, credits: TEST_PACK.credits,
  });
  if (error) throw new Error("Could not save test order. Check the payment migration.");
  const data = await paystack("/transaction/initialize", {
    reference, email, amount: TEST_PACK.amount, currency: TEST_PACK.currency,
    callback_url: `${origin}/billing/test`,
    metadata: { sandbox: true, pack: TEST_PACK.id },
  });
  const url = new URL(data.authorization_url);
  if (url.protocol !== "https:" || url.hostname !== "checkout.paystack.com" || data.reference !== reference) {
    throw new Error("Unexpected checkout response.");
  }
  return url.href;
}

export async function verifyTestPayment(reference: string, userId?: string) {
  sandboxKey();
  if (!/^pr-test-[0-9a-f-]{36}$/.test(reference)) throw new Error("Invalid payment reference.");
  const db = createSupabaseAdminClient();
  let query = db.from("pulse_reel_test_orders").select("*").eq("reference", reference);
  if (userId) query = query.eq("user_id", userId);
  const { data: order, error } = await query.single();
  if (error || !order) throw new Error("Test order not found.");
  if (order.paid) return;
  const transaction = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (!matchesOrder(transaction, order)) throw new Error("Payment is not a matching successful test transaction.");
  // One order is one credit grant; repeat callbacks/webhooks cannot add another grant.
  const { error: updateError } = await db.from("pulse_reel_test_orders")
    .update({ paid: true }).eq("reference", reference).eq("paid", false);
  if (updateError) throw new Error("Could not record verified test payment. Retry verification.");
}

export async function testCreditBalance(userId: string) {
  const { data, error } = await createSupabaseAdminClient().from("pulse_reel_test_orders")
    .select("credits").eq("user_id", userId).eq("paid", true);
  if (error) throw new Error("Test credit storage is not ready.");
  return (data ?? []).reduce((total, order) => total + order.credits, 0);
}
