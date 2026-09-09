import { NextResponse } from "next/server";
import { liveKey, verifyLivePayment } from "@/lib/paystack-live";
import { validSignature } from "@/lib/paystack-validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const key = liveKey();
    const body = await request.text();
    if (!validSignature(body, request.headers.get("x-paystack-signature"), key)) {
      return new NextResponse("Invalid signature", { status: 401 });
    }
    const event = JSON.parse(body);
    if (event.event === "charge.success" && event.data?.domain === "live" &&
      typeof event.data?.reference === "string" && event.data.reference.startsWith("pr-live-")) {
      await verifyLivePayment(event.data.reference);
    }
    return NextResponse.json({ received: true });
  } catch {
    return new NextResponse("Webhook processing unavailable; retry", { status: 503 });
  }
}
