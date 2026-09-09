import { createHmac, timingSafeEqual } from "node:crypto";

export const TEST_PACK = { id: "sandbox-5", credits: 5, amount: 10000, currency: "KES" } as const;

export function requireTestKey(key: string | undefined) {
  if (!key?.startsWith("sk_test_") || key.length < 16) {
    throw new Error("Paystack sandbox requires a test secret key. Live keys are rejected.");
  }
  return key;
}

export function requireLiveKey(key: string | undefined) {
  if (!key?.startsWith("sk_live_") || key.length < 16) {
    throw new Error("Paystack live billing requires a live secret key. Test keys are rejected.");
  }
  return key;
}

export function validSignature(body: string, signature: string | null, key: string) {
  if (!signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", key).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export function matchesOrder(data: Record<string, unknown>, order: {
  reference: string; amount: number; currency: string; email: string;
}) {
  const customer = data.customer as { email?: string } | undefined;
  return data.domain === "test" && data.status === "success" &&
    data.reference === order.reference && data.amount === order.amount &&
    data.currency === order.currency &&
    customer?.email?.toLowerCase() === order.email.toLowerCase();
}

export function matchesLiveOrder(data: Record<string, unknown>, order: {
  reference: string; amount: number; currency: string; email: string;
}) {
  const customer = data.customer as { email?: string } | undefined;
  return data.domain === "live" && data.status === "success" &&
    data.reference === order.reference && data.amount === order.amount &&
    data.currency === order.currency &&
    customer?.email?.toLowerCase() === order.email.toLowerCase();
}
