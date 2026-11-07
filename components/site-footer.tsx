export function SiteFooter() {
  return (
    <footer className="site-footer" aria-label="MimiScene information">
      <span>MimiScene beta</span>
      <nav aria-label="Legal and safety">
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/identity-safety">Identity safety</a>
        <a href="/data-deletion">Delete my data</a>
      </nav>
    </footer>
  );
}
