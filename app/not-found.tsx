import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="shell" style={{ padding: "72px 0" }}>
      <section className="panel glass" style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
        <p className="eyebrow-copy">Missing Page</p>
        <h1 className="heading">That movie link does not exist yet.</h1>
        <p className="subtle">Head back to the studio and publish a fresh one.</p>
        <div className="cta-row" style={{ justifyContent: "center" }}>
          <Link className="button" href="/create">
            Open Studio
          </Link>
          <Link className="button-secondary" href="/">
            Return Home
          </Link>
        </div>
      </section>
    </main>
  );
}
