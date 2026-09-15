import { NextResponse } from "next/server";
import { LAUNCH_PACK } from "@/lib/billing-pack";
import { getRequestUser } from "@/lib/auth/request-user";
import { paymentOrigin } from "@/lib/paystack";
import {
  BillingRequestError,
  initializeLivePayment,
  isLiveCheckoutReady,
  paidAttemptBalance,
  verifyLivePayment,
} from "@/lib/paystack-live";

export const runtime = "nodejs";

function offer() {
  return {
    attempts: LAUNCH_PACK.attempts,
    amount: LAUNCH_PACK.amount,
    currency: LAUNCH_PACK.currency,
    approximateUsd: LAUNCH_PACK.approximateUsd,
  };
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user?.email_confirmed_at) return NextResponse.json({ error: "Verified account required." }, { status: 403 });
  try {
    return NextResponse.json({
      attempts: await paidAttemptBalance(user.id),
      ready: isLiveCheckoutReady(),
      offer: offer(),
    });
  } catch (error) {
    console.error("PulseReel billing balance request failed.", error);
    return NextResponse.json({ error: "Billing balance unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user?.email || !user.email_confirmed_at) {
    return NextResponse.json({ error: "Verified account required." }, { status: 403 });
  }
  try {
    const hasBearerToken = /^Bearer\s+\S+/i.test(request.headers.get("authorization") ?? "");
    if (!hasBearerToken && request.headers.get("origin") !== paymentOrigin()) {
      return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
    }
    const body = await request.json();
    if (body.action === "initialize") {
      const callbackPath = body.client === "mobile" ? "/billing/mobile-return" : "/billing";
      return NextResponse.json({
        url: await initializeLivePayment(user.id, user.email, callbackPath),
      });
    }
    if (body.action === "verify" && typeof body.reference === "string") {
      return NextResponse.json({ attempts: await verifyLivePayment(body.reference, user.id) });
    }
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  } catch (error) {
    if (error instanceof BillingRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("PulseReel live billing request failed.", error);
    return NextResponse.json({ error: "Billing request unavailable. No attempts were granted unless Paystack verification succeeded." }, { status: 503 });
  }
}
