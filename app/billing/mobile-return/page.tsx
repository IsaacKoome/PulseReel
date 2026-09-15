import { verifyLivePayment } from "@/lib/paystack-live";

export const dynamic = "force-dynamic";

export default async function MobileBillingReturn({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parameters = await searchParams;
  const rawReference = parameters.reference ?? parameters.trxref;
  const reference = Array.isArray(rawReference) ? rawReference[0] : rawReference;
  let confirmed = false;

  if (reference) {
    try {
      await verifyLivePayment(reference);
      confirmed = true;
    } catch {
      /* Paystack's signed webhook can still confirm a recently completed payment. */
    }
  }

  return (
    <main style={{ maxWidth: 620, margin: "80px auto", padding: 24, textAlign: "center" }}>
      <p className="eyebrow">PULSEREEL CREDITS</p>
      <h1>{confirmed ? "Your attempts are ready." : "Payment submitted."}</h1>
      <p>
        {confirmed
          ? "Return to PulseReel and start your next movie."
          : "Return to PulseReel and check again in a moment while Paystack confirms the payment."}
      </p>
      <p style={{ marginTop: 28 }}>
        <a className="button" href="pulsereel://billing">Return to PulseReel</a>
      </p>
    </main>
  );
}
