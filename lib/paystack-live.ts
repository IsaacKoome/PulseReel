import { randomUUID } from "node:crypto";
import { LAUNCH_PACK } from "@/lib/billing-pack";
import { paymentOrigin } from "@/lib/paystack";
import { matchesLiveOrder, requireLiveKey } from "@/lib/paystack-validation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export function liveKey() {
  return requireLiveKey(process.env.PAYSTACK_LIVE_SECRET_KEY?.trim());
}

export function areLivePurchasesEnabled() {
  return process.env.PULSEREEL_PAYSTACK_LIVE_ENABLED === "true";
}

export function isLiveCheckoutReady() {
  try {
    liveKey();
    paymentOrigin();
    return areLivePurchasesEnabled();
  } catch {
    return false;
  }
}

async function livePaystack(path: string, body?: Record<string, unknown>) {
  const response = await fetch(`https://api.paystack.co${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${liveKey()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok || result.status !== true || !result.data) {
    throw new Error("Paystack request failed.");
  }
  return result.data as Record<string, unknown>;
}

export async function paidAttemptBalance(userId: string) {
  const { data, error } = await createSupabaseAdminClient()
    .from("pulse_reel_paid_wallets")
    .select("available")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Paid-attempt storage is unavailable.");
  return Number(data?.available ?? 0);
}

export async function initializeLivePayment(userId: string, email: string) {
  if (!areLivePurchasesEnabled()) throw new Error("Live purchases are disabled.");
  liveKey();
  const reference = `pr-live-${randomUUID()}`;
  const origin = paymentOrigin();
  const db = createSupabaseAdminClient();
  const rateLimitStart = new Date(Date.now() - 5 * 60_000).toISOString();
  const { count: recentOrderCount, error: rateLimitError } = await db
    .from("pulse_reel_paid_orders")
    .select("reference", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", rateLimitStart);
  if (rateLimitError) throw new Error("Could not check checkout limits.");
  if ((recentOrderCount ?? 0) >= 3) {
    throw new Error("Too many checkout attempts. Please wait five minutes before trying again.");
  }
  const { error } = await db.from("pulse_reel_paid_orders").insert({
    reference,
    user_id: userId,
    email,
    pack_id: LAUNCH_PACK.id,
    amount: LAUNCH_PACK.amount,
    currency: LAUNCH_PACK.currency,
    attempts: LAUNCH_PACK.attempts,
  });
  if (error) throw new Error("Could not create the payment order.");

  const data = await livePaystack("/transaction/initialize", {
    reference,
    email,
    amount: LAUNCH_PACK.amount,
    currency: LAUNCH_PACK.currency,
    callback_url: `${origin}/billing`,
    metadata: { product: "pulsereel", pack: LAUNCH_PACK.id },
  });
  const url = new URL(String(data.authorization_url ?? ""));
  if (url.protocol !== "https:" || url.hostname !== "checkout.paystack.com" || data.reference !== reference) {
    throw new Error("Unexpected checkout response.");
  }
  return url.href;
}

export async function verifyLivePayment(reference: string, userId?: string) {
  liveKey();
  if (!/^pr-live-[0-9a-f-]{36}$/.test(reference)) throw new Error("Invalid payment reference.");
  const db = createSupabaseAdminClient();
  let query = db.from("pulse_reel_paid_orders").select("*").eq("reference", reference);
  if (userId) query = query.eq("user_id", userId);
  const { data: order, error } = await query.single();
  if (error || !order) throw new Error("Payment order not found.");
  if (!order.paid) {
    const transaction = await livePaystack(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (!matchesLiveOrder(transaction, order)) throw new Error("Payment is not a matching successful live transaction.");
    const { error: grantError } = await db.rpc("pulsereel_grant_paid_order", { p_reference: reference });
    if (grantError) throw new Error("Could not grant paid attempts.");
  }
  return paidAttemptBalance(order.user_id);
}
