import Link from "next/link";
import { LAUNCH_PACK, launchPackPrice } from "@/lib/billing-pack";
import { getCurrentUser } from "@/lib/auth/user";
import { isLiveCheckoutReady, paidAttemptBalance } from "@/lib/paystack-live";
import BillingCheckout from "./checkout";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const user = await getCurrentUser();
  let attempts = 0;
  if (user?.email_confirmed_at) {
    try { attempts = await paidAttemptBalance(user.id); } catch { /* Migration or storage unavailable. */ }
  }
  const ready = Boolean(user?.email_confirmed_at && isLiveCheckoutReady());
  return (
    <main style={{ maxWidth: 760, margin: "64px auto", padding: 24 }}>
      <Link className="button-secondary" href="/">Back to home</Link>
      <p className="eyebrow" style={{ marginTop: 40 }}>PulseReel credits · Coming soon</p>
      <h1>{LAUNCH_PACK.attempts} video attempts</h1>
      <p style={{ fontSize: "2rem", fontWeight: 700, marginBottom: 8 }}>
        Approximately US${LAUNCH_PACK.approximateUsd}
      </p>
      <p><strong>Charged as {launchPackPrice()} per pack.</strong> Your bank determines the final amount in your currency and may charge a conversion fee.</p>
      <section style={{ border: "1px solid var(--line)", borderRadius: 24, padding: 24, margin: "28px 0" }}>
        <h2>What is included?</h2>
        <ul>
          <li>5 attempts to generate a 5-second AI clip, in 480p portrait format with audio.</li>
          <li>One attempt per generation. A new variation uses another attempt.</li>
          <li>Technical generation failures return the attempt automatically once confirmed.</li>
          <li>AI results can vary. Exact likeness and a particular creative result are not guaranteed.</li>
        </ul>
        <BillingCheckout signedIn={Boolean(user?.email_confirmed_at)} ready={ready} initialAttempts={attempts} />
      </section>
      <p>Sandbox credits are for testing only and are separate from paid attempts.</p>
      <p><Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link></p>
    </main>
  );
}
