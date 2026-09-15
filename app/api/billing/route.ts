import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/user";
import { paymentOrigin } from "@/lib/paystack";
import {
  BillingRequestError,
  initializeLivePayment,
  paidAttemptBalance,
  verifyLivePayment,
} from "@/lib/paystack-live";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user?.email_confirmed_at) return NextResponse.json({ error: "Verified account required." }, { status: 403 });
  try {
    return NextResponse.json({ attempts: await paidAttemptBalance(user.id) });
  } catch (error) {
    console.error("PulseReel billing balance request failed.", error);
    return NextResponse.json({ error: "Billing balance unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.email || !user.email_confirmed_at) {
    return NextResponse.json({ error: "Verified account required." }, { status: 403 });
  }
  try {
    if (request.headers.get("origin") !== paymentOrigin()) {
      return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
    }
    const body = await request.json();
    if (body.action === "initialize") {
      return NextResponse.json({ url: await initializeLivePayment(user.id, user.email) });
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
