import { PolicyPage, SupportContact } from "@/components/policy-page";

export const metadata = {
  title: "Identity Safety | PulseReel",
  description: "Consent and identity-safety rules for PulseReel movies.",
};

export default function IdentitySafetyPage() {
  return (
    <PolicyPage
      eyebrow="Identity safety"
      title="A face is not just an input."
      intro="PulseReel is built around personal identity. That makes meaningful consent and careful sharing essential."
    >
      <section>
        <h2>Use your own identity</h2>
        <p>
          The safest use of PulseReel is creating a fictional movie starring yourself. If another person is
          visible or identifiable, obtain their informed permission before uploading or generating anything.
        </p>
      </section>
      <section>
        <h2>Children and vulnerable people</h2>
        <p>
          Do not upload a child&apos;s identity unless you are their parent or legal guardian and the use is safe,
          appropriate, and lawful. Never create exploitative, sexual, humiliating, or deceptive identity content.
        </p>
      </section>
      <section>
        <h2>Sharing an unlisted movie</h2>
        <p>
          Unlisted means a movie is omitted from PulseReel&apos;s public feed; it does not make the watch link a
          secret vault. A recipient can forward or download the movie. Share only with people you trust.
        </p>
      </section>
      <section>
        <h2>Report or remove identity content</h2>
        <p>
          Account owners can delete their movies from My Movies. If your identity appears in a PulseReel movie
          without permission, include the watch link in a removal request.
        </p>
        <SupportContact />
      </section>
    </PolicyPage>
  );
}
