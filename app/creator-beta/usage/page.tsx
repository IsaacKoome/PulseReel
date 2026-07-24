import Link from "next/link";
import { CreatorBetaUsage } from "@/components/creator-beta-usage";

export const dynamic = "force-dynamic";

export default function CreatorBetaUsagePage() {
  return (
    <main className="studio-shell shell">
      <header className="app-header compact-header">
        <Link className="brand-mark" href="/">PulseReel</Link>
        <Link className="button-secondary" href="/create">Creator Studio</Link>
      </header>
      <section className="home-feed-head">
        <div>
          <span className="eyebrow">Private operations</span>
          <h1>Creator Beta usage</h1>
          <p>Track managed starts, creator-funded jobs, failures, and estimated exposure.</p>
        </div>
      </section>
      <CreatorBetaUsage />
    </main>
  );
}
