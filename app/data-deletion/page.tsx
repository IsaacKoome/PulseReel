import { PolicyPage, SupportContact } from "@/components/policy-page";

export const metadata = {
  title: "Delete My Data | PulseReel",
  description: "How to delete a PulseReel movie or request account deletion.",
};

export default function DataDeletionPage() {
  return (
    <PolicyPage
      eyebrow="Data controls"
      title="Delete a movie or your account data."
      intro="Signing out does not delete your movies or account. Use the appropriate option below."
    >
      <section>
        <h2>Delete one movie</h2>
        <ol>
          <li>Sign in to the Google account used to create the movie.</li>
          <li>Open My Movies.</li>
          <li>Select Delete on the movie and confirm the request.</li>
        </ol>
      </section>
      <section>
        <h2>Request account deletion</h2>
        <p>
          Send a deletion request from the same email address used to sign in. Include the words
          &quot;Delete my PulseReel account&quot;. We may ask you to confirm ownership before removing account-linked
          project records and requesting deletion from applicable service providers.
        </p>
        <SupportContact />
      </section>
      <section>
        <h2>What may remain temporarily</h2>
        <p>
          Limited records may remain in provider backups, fraud-prevention records, or security logs until
          their normal expiration period. We will not use deleted identity media to create new movies.
        </p>
      </section>
    </PolicyPage>
  );
}
