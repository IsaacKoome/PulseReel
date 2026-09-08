import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/user";
import { isPulseReelAdmin } from "@/lib/auth/admin";
import { sandboxKey, testCreditBalance } from "@/lib/paystack";
import Checkout from "./checkout";

export const dynamic = "force-dynamic";

export default async function PaymentTestPage() {
  const user = await getCurrentUser();
  if (!user?.email_confirmed_at || !isPulseReelAdmin(user)) notFound();
  let ready = false;
  let credits = 0;
  try { sandboxKey(); credits = await testCreditBalance(user.id); ready = true; } catch { /* Disabled until configured. */ }
  return <main style={{ maxWidth: 700, margin: "80px auto", padding: 24 }}>
    <h1>Paystack payment sandbox</h1>
    <p>Admin-only test. No real money is charged. Test credits cannot generate AI videos.</p>
    <p>Sample pack: 5 test credits for KES 100. This is not the launch price.</p>
    {!ready && <p>Setup required: apply the test-orders migration and configure the server test key and sandbox flag.</p>}
    <Checkout ready={ready} initialCredits={credits} />
  </main>;
}
