import { PolicyPage, SupportContact } from "@/components/policy-page";

export const metadata = {
  title: "Terms | PulseReel",
  description: "Terms for using the PulseReel beta.",
};

export default function TermsPage() {
  return (
    <PolicyPage
      eyebrow="Beta terms"
      title="Create responsibly."
      intro="PulseReel is an early identity-first movie-generation beta. These terms are intentionally written in plain language."
    >
      <section>
        <h2>Your permission</h2>
        <p>
          Upload only footage and identity references that belong to you or that you have clear permission
          and legal authority to use. You remain responsible for your prompts, uploads, generated movies,
          and the way you publish or share them.
        </p>
      </section>
      <section>
        <h2>Prohibited use</h2>
        <p>
          Do not use PulseReel for impersonation, fraud, harassment, non-consensual intimate content,
          deceptive political material, exploitation of minors, illegal activity, or infringement of
          another person&apos;s privacy, publicity, or intellectual-property rights.
        </p>
      </section>
      <section>
        <h2>AI output</h2>
        <p>
          AI-generated video can contain visual mistakes, altered identity details, invented people or
          events, and other unexpected output. Review a movie before sharing it and do not present fictional
          generated scenes as evidence of real events.
        </p>
      </section>
      <section>
        <h2>Beta availability and costs</h2>
        <p>
          Models, durations, audio, generation limits, and availability may change. A generation can fail
          because of provider limits or invalid input. PulseReel may pause generation to control spending,
          protect users, or maintain the service.
        </p>
      </section>
      <section>
        <h2>Processing permission</h2>
        <p>
          You keep your rights in your uploads. You give PulseReel and its service providers the limited
          permission needed to store, transform, transmit, and process those materials to operate the service
          and produce the movie you requested.
        </p>
      </section>
      <section>
        <h2>Contact</h2>
        <SupportContact />
      </section>
    </PolicyPage>
  );
}
