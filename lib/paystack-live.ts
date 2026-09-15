import { randomUUID } from "node:crypto";
import { LAUNCH_PACK } from "@/lib/billing-pack";
import { paymentOrigin } from "@/lib/paystack";
import { matchesLiveOrder, requireLiveKey } from "@/lib/paystack-validation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export class BillingRequestError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "BillingRequestError";
  }
}

export type PaidOrderSummary = {
  reference: string;
  amount: number;
  currency: string;
  attempts: number;
  paid: boolean;
  createdAt: string;
};

export type BillingAdminSnapshot = {
  totalCollected: number;
  paidOrders: number;
  incompleteOrders: number;
  availableAttempts: number;
  reservedAttempts: number;
  staleReservations: number;
  recentOrders: Array<PaidOrderSummary & { userId: string; email: string }>;
  recentAttempts: Array<{
    id: string;
    userId: string;
    projectId: string | null;
    status: "reserved" | "completed" | "failed";
    createdAt: string;
    updatedAt: string;
    stale: boolean;
  }>;
  recentLedger: Array<{
    id: number;
    userId: string;
    eventKey: string;
    delta: number;
    createdAt: string;
  }>;
};

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

export async function paidOrderHistory(userId: string, limit = 20): Promise<PaidOrderSummary[]> {
  const { data, error } = await createSupabaseAdminClient()
    .from("pulse_reel_paid_orders")
    .select("reference,amount,currency,attempts,paid,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("Paid-order history is unavailable.");
  return (data ?? []).map((order) => ({
    reference: order.reference,
    amount: Number(order.amount),
    currency: order.currency,
    attempts: Number(order.attempts),
    paid: Boolean(order.paid),
    createdAt: order.created_at,
  }));
}

export async function getBillingAdminSnapshot(): Promise<BillingAdminSnapshot> {
  const db = createSupabaseAdminClient();
  const [ordersResult, walletsResult, attemptsResult, ledgerResult] = await Promise.all([
    db
      .from("pulse_reel_paid_orders")
      .select("reference,user_id,email,amount,currency,attempts,paid,created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    db.from("pulse_reel_paid_wallets").select("available"),
    db
      .from("pulse_reel_paid_attempts")
      .select("id,user_id,project_id,status,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("pulse_reel_paid_ledger")
      .select("id,user_id,event_key,delta,created_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  if (ordersResult.error || walletsResult.error || attemptsResult.error || ledgerResult.error) {
    throw new Error("Paid billing records are unavailable.");
  }

  const orders = ordersResult.data ?? [];
  const attempts = attemptsResult.data ?? [];
  const staleBefore = Date.now() - 30 * 60_000;
  const recentAttempts = attempts.map((attempt) => ({
    id: attempt.id,
    userId: attempt.user_id,
    projectId: attempt.project_id,
    status: attempt.status as "reserved" | "completed" | "failed",
    createdAt: attempt.created_at,
    updatedAt: attempt.updated_at,
    stale: attempt.status === "reserved" && new Date(attempt.updated_at).getTime() < staleBefore,
  }));

  return {
    totalCollected: orders
      .filter((order) => order.paid && order.currency === "KES")
      .reduce((sum, order) => sum + Number(order.amount), 0),
    paidOrders: orders.filter((order) => order.paid).length,
    incompleteOrders: orders.filter((order) => !order.paid).length,
    availableAttempts: (walletsResult.data ?? []).reduce(
      (sum, wallet) => sum + Number(wallet.available),
      0,
    ),
    reservedAttempts: recentAttempts.filter((attempt) => attempt.status === "reserved").length,
    staleReservations: recentAttempts.filter((attempt) => attempt.stale).length,
    recentOrders: orders.map((order) => ({
      reference: order.reference,
      userId: order.user_id,
      email: order.email,
      amount: Number(order.amount),
      currency: order.currency,
      attempts: Number(order.attempts),
      paid: Boolean(order.paid),
      createdAt: order.created_at,
    })),
    recentAttempts,
    recentLedger: (ledgerResult.data ?? []).map((entry) => ({
      id: Number(entry.id),
      userId: entry.user_id,
      eventKey: entry.event_key,
      delta: Number(entry.delta),
      createdAt: entry.created_at,
    })),
  };
}

export async function initializeLivePayment(
  userId: string,
  email: string,
  callbackPath: "/billing" | "/billing/mobile-return" = "/billing",
) {
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
    throw new BillingRequestError(
      "Too many checkout attempts. Please wait five minutes before trying again.",
      "checkout_rate_limited",
      429,
    );
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
    callback_url: `${origin}${callbackPath}`,
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
    if (transaction.domain !== "live") {
      throw new BillingRequestError("This is not a live payment.", "not_live", 409);
    }
    if (transaction.status !== "success") {
      throw new BillingRequestError(
        "Paystack has not confirmed this payment. If you completed it, wait a moment and recheck.",
        "payment_not_confirmed",
        409,
      );
    }
    if (!matchesLiveOrder(transaction, order)) {
      throw new BillingRequestError(
        "The confirmed payment details do not match this PulseReel order.",
        "payment_mismatch",
        409,
      );
    }
    const { error: grantError } = await db.rpc("pulsereel_grant_paid_order", { p_reference: reference });
    if (grantError) throw new Error("Could not grant paid attempts.");
  }
  return paidAttemptBalance(order.user_id);
}
