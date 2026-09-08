import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/user";
import { isPulseReelAdmin } from "@/lib/auth/admin";
import { initializeTestPayment, paymentOrigin, testCreditBalance, verifyTestPayment } from "@/lib/paystack";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.email || !user.email_confirmed_at || !isPulseReelAdmin(user)) {
    return NextResponse.json({ error: "Verified admin account required." }, { status: 403 });
  }
  try {
    if (request.headers.get("origin") !== paymentOrigin()) {
      return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
    }
    const body = await request.json();
    if (body.action === "initialize") {
      return NextResponse.json({ url: await initializeTestPayment(user.id, user.email) });
    }
    if (body.action === "verify" && typeof body.reference === "string") {
      await verifyTestPayment(body.reference, user.id);
      return NextResponse.json({ credits: await testCreditBalance(user.id) });
    }
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Sandbox request failed. Check test configuration, or retry verification if payment is pending." }, { status: 503 });
  }
}
