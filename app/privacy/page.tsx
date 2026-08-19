import { PolicyPage, SupportContact } from "@/components/policy-page";

export const metadata = {
  title: "Privacy | PulseReel",
  description: "How PulseReel handles account, identity, and movie-generation data.",
};

export default function PrivacyPage() {
  return (
    <PolicyPage
      eyebrow="Privacy"
      title="Your identity deserves careful handling."
      intro="This notice explains what PulseReel collects during the beta, why it is needed, and the choices available to you."
    >
      <section>
        <h2>Information we handle</h2>
        <ul>
          <li>Your Google account identifier, name, email address, and profile image when provided by Google.</li>
          <li>The video clips, identity selfies, prompts, styles, and model choices you submit.</li>
          <li>Generated movies, posters, processing status, and technical records needed to operate the service.</li>
        </ul>
      </section>
      <section>
        <h2>How we use it</h2>
        <p>
          We use this information to authenticate you, generate and deliver your movie, associate it
          with your account, prevent unauthorized deletion, troubleshoot failures, and protect the beta
          from abuse and uncontrolled generation costs. Google account information is not used for advertising.
        </p>
      </section>
      <section>
        <h2>Processors and AI providers</h2>
        <p>
          PulseReel relies on service providers including Supabase for authentication, Vercel for hosting
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
          individual movies from My Movies. For account-level deletion, follow the instructions on the
          Delete my data page. Provider backups and operational logs may take additional time to expire.
        </p>
      </section>
      <section>
        <h2>Contact</h2>
        <SupportContact />
      </section>
    </PolicyPage>
  );
}
