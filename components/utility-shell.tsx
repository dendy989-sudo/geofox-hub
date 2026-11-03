import Link from "next/link";

export function UtilityShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header utility-header">
        <Link className="brand" href="/" aria-label="Geofox Apps home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 40 40" fill="none">
              <path d="m5 5 15 9L35 5l-3 22-12 9L8 27 5 5Z" fill="currentColor" />
              <path d="m8 13 12 9 12-9-3 13-9 7-9-7-3-13Z" fill="#FBF8F2" />
              <path d="m15 24 5 3 5-3-5 9-5-9Z" fill="currentColor" />
            </svg>
          </span>
          <span>geofox<span className="brand-suffix">apps</span></span>
        </Link>
        <Link className="text-link" href="/">Back to home <span aria-hidden="true">↗</span></Link>
      </header>
      <main id="main-content" className="utility-main">{children}</main>
      <footer className="site-footer utility-footer">
        <span>© {new Date().getFullYear()} GEOFOX APPS LLC</span>
        <nav className="footer-links" aria-label="Footer navigation">
          <Link href="/support">Support</Link>
          <Link href="/admin/login">Staff sign in</Link>
        </nav>
      </footer>
    </div>
  );
}
