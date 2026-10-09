import { PolicyPage, SupportContact } from "@/components/policy-page";

export const metadata = {
  title: "Privacy | MimiReel",
  description: "How MimiReel handles account, identity, and movie-generation data.",
};

export default function PrivacyPage() {
  return (
    <PolicyPage
      eyebrow="Privacy"
      title="Your identity deserves careful handling."
      intro="This notice explains what MimiReel collects during the beta, why it is needed, and the choices available to you."
      updated="October 9, 2026"
    >
      <section>
        <h2>Information we handle</h2>
        <ul>
          <li>Your Google account identifier, name, email address, and profile image when provided by Google.</li>
          <li>The video clips, identity selfies, prompts, styles, and model choices you submit.</li>
          <li>Generated movies, posters, processing status, and technical records needed to operate the service.</li>
          <li>Social activity such as likes, follows, comments, shares, reports, and creator blocks.</li>
          <li>Movie ratings, willingness-to-pay answers, and other optional feedback you submit during the beta.</li>
        </ul>
      </section>
      <section>
        <h2>How we use it</h2>
        <p>
          We use this information to authenticate you, generate and deliver your movie, associate it
          with your account, prevent unauthorized deletion, troubleshoot failures, and protect the beta
          from abuse and uncontrolled generation costs. Beta feedback is used to improve identity accuracy,
          movie quality, and product decisions. Reports and blocks are used to review harmful content and
          keep unwanted creators out of your feed. Google account information is not used for advertising.
        </p>
      </section>
      <section>
        <h2>How we protect it</h2>
        <p>
          We use HTTPS to send information between the app and our services. Sign-in and service
          permissions control access to account-linked records. We limit the information sent to
          service providers to what is needed for the features you use.
        </p>
      </section>
      <section>
        <h2>Payments</h2>
        <p>
          MimiReel&apos;s Google Play release does not use the web checkout for digital purchases. If in-app
          purchases are enabled later, they will use Google Play Billing and applicable purchase records
          will be handled by Google and MimiReel for fulfillment, fraud prevention, and support.
        </p>
      </section>
      <section>
        <h2>Processors and AI providers</h2>
        <p>
          MimiReel relies on service providers including Supabase for authentication, Vercel for hosting
          and storage, and the AI provider selected for generation, such as Replicate. The minimum inputs
          needed to perform a generation may be sent to those providers and handled under their own service terms.
        </p>
      </section>
      <section>
        <h2>Movie visibility</h2>
        <p>
          New movies created by signed-in beta users are unlisted by default. They do not appear in the
          public home feed, but anyone who receives the unique watch link may be able to view or forward it.
          Legacy showcase movies and movies deliberately published later may be public.
        </p>
      </section>
      <section>
        <h2>Retention and deletion</h2>
        <p>
          We retain account and project records while they are needed to provide the beta. You can delete
          individual movies from My Movies. You can submit an account-level deletion request inside the
          mobile app under Profile, Account and data, or follow the alternative instructions on the <a href="/data-deletion">Delete
          my data page</a>. After identity verification, account-linked live data is removed or anonymized as
          applicable. Provider backups, fraud-prevention records, and operational logs may remain until
          their normal retention periods expire.
        </p>
      </section>
      <section>
        <h2>Contact</h2>
        <SupportContact />
      </section>
    </PolicyPage>
  );
}
