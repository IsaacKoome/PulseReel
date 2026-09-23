import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";

export function PolicyPage({
  eyebrow,
  title,
  intro,
  updated = "August 19, 2026",
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  updated?: string;
  children: ReactNode;
}) {
  return (
    <main className="policy-shell shell">
      <header className="policy-header">
        <a className="brand-mark" href="/">MimiReel</a>
        <a className="button-secondary" href="/">Home</a>
      </header>
      <article className="policy-card glass">
        <p className="eyebrow-copy">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="policy-intro">{intro}</p>
        <p className="policy-updated">Last updated: {updated}</p>
        <div className="policy-content">{children}</div>
      </article>
      <SiteFooter />
    </main>
  );
}

export function SupportContact() {
  const supportEmail = process.env.NEXT_PUBLIC_PULSEREEL_SUPPORT_EMAIL?.trim();

  if (!supportEmail) {
    return (
      <p>
        During the private beta, use the MimiReel support address displayed on the Google sign-in
        consent screen. A dedicated public support address will be added before the open beta.
      </p>
    );
  }

  return <p>Email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p>;
}
