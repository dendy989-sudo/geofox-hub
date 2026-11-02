function ArrowIcon({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="arrow-icon">
      {diagonal ? (
        <path d="M6 18 18 6M6 6h12v12" />
      ) : (
        <path d="M4 12h15m-6-6 6 6-6 6" />
      )}
    </svg>
  );
}

function FoxMark() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="m5 5 15 9L35 5l-3 22-12 9L8 27 5 5Z" fill="currentColor" />
      <path d="m8 13 12 9 12-9-3 13-9 7-9-7-3-13Z" fill="#FBF8F2" />
      <path d="m15 24 5 3 5-3-5 9-5-9Z" fill="currentColor" />
    </svg>
  );
}

function BookArtwork() {
  return (
    <svg className="book-artwork" viewBox="0 0 440 320" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="book-cover" x1="139" y1="71" x2="320" y2="247" gradientUnits="userSpaceOnUse">
          <stop stopColor="#C3B5F2" />
          <stop offset="1" stopColor="#7761B2" />
        </linearGradient>
        <linearGradient id="book-page" x1="150" y1="89" x2="296" y2="217" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFCF5" />
          <stop offset="1" stopColor="#E8E1CE" />
        </linearGradient>
        <radialGradient id="book-glow" cx="0" cy="0" r="1" gradientTransform="translate(220 147) rotate(90) scale(125 165)" gradientUnits="userSpaceOnUse">
          <stop stopColor="#BBA5F1" stopOpacity=".24" />
          <stop offset="1" stopColor="#BBA5F1" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="220" cy="149" rx="180" ry="136" fill="url(#book-glow)" />
      <ellipse cx="226" cy="272" rx="96" ry="11" fill="#100E1A" fillOpacity=".35" />
      <path d="M131 91c35-6 66 5 89 26 23-21 54-32 89-26l8 143c-40-5-70 6-97 23-27-17-57-28-97-23l8-143Z" fill="url(#book-cover)" />
      <path d="M141 79c31-2 56 9 79 29 23-20 48-31 79-29l6 143c-34 0-61 12-85 27-24-15-51-27-85-27l6-143Z" fill="url(#book-page)" />
      <path d="M220 108v141" stroke="#CEC4B0" strokeWidth="2" />
      <path d="M151 107c20 2 38 9 54 20m-54-1c20 2 38 9 54 20m-54-1c20 2 38 9 54 20m-54-1c20 2 38 9 54 20m-54-1c15 2 28 6 41 13m43-69c16-11 34-18 54-20m-54 39c16-11 34-18 54-20m-54 39c16-11 34-18 54-20m-54 39c16-11 34-18 54-20m-54 39c12-8 25-14 39-17" stroke="#BDB29E" strokeWidth="2" strokeLinecap="round" opacity=".65" />
      <path d="m266 82 15-3 4 71-9-4-7 7-3-71Z" fill="#9174C8" />
      <path d="m104 125 3 11 11 3-11 3-3 11-3-11-11-3 11-3 3-11Zm223 34 4 13 13 4-13 4-4 13-4-13-13-4 13-4 4-13ZM250 37l3 10 10 3-10 3-3 10-3-10-10-3 10-3 3-10Z" fill="#D8CCEF" />
      <circle cx="149" cy="49" r="3" fill="#E6DBF8" />
      <circle cx="344" cy="91" r="2.5" fill="#E6DBF8" />
      <circle cx="93" cy="206" r="2" fill="#E6DBF8" />
      <circle cx="310" cy="239" r="2" fill="#E6DBF8" />
      <path d="M78 96c9-24 28-42 52-51m191 2c18 8 33 21 44 37" stroke="#A794CE" strokeOpacity=".25" strokeLinecap="round" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="site-shell">
        <header className="site-header">
          <a className="brand" href="/" aria-label="Geofox Apps home">
            <span className="brand-mark"><FoxMark /></span>
            <span>geofox<span className="brand-suffix">apps</span></span>
          </a>
          <nav className="nav-links" aria-label="Main navigation">
            <a href="#apps">Our apps</a>
            <a href="#company">Our company</a>
            <a className="nav-support" href="/support">Get support <ArrowIcon /></a>
          </nav>
        </header>

        <main id="main-content">
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-copy">
              <p className="eyebrow"><span className="eyebrow-dot" /> Independent app studio</p>
              <h1 id="hero-title">Apps for the<br />things you <span className="hero-emphasis">love.</span></h1>
              <p className="hero-description">A good app makes a little room for what matters. We create thoughtful digital spaces for everyday interests, starting with your next chapter.</p>
              <div className="hero-actions">
                <a className="button" href="#apps">Meet our first app <ArrowIcon /></a>
                <a className="text-link" href="#company">Get to know Geofox</a>
              </div>
              <div className="hero-signature">
                <span className="signature-line" />
                <p>Fresh ideas. Thoughtfully made.<br /><strong>GEOFOX APPS LLC</strong></p>
              </div>
            </div>

            <article id="apps" className="app-spotlight" aria-labelledby="novanook-title">
              <div className="spotlight-art">
                <div className="spotlight-topline"><span>OUR FIRST CHAPTER</span><span className="spotlight-number">01</span></div>
                <BookArtwork />
                <p className="art-caption">A little magic for your reading life.</p>
              </div>
              <div className="spotlight-body">
                <div className="app-title-row">
                  <div>
                    <p className="app-category">FOR THE LOVE OF BOOKS</p>
                    <h2 id="novanook-title">NovaNook</h2>
                  </div>
                  <span className="app-symbol" aria-hidden="true">N<span>✦</span></span>
                </div>
                <p>Your books, your reading journey, your own little world. Build a personal library, track your progress, and make your reading space feel like you.</p>
                <div className="feature-tags" aria-label="NovaNook features">
                  <span>Personal libraries</span><span>Reading goals</span><span>A touch of magic</span>
                </div>
                <a className="app-link" href="https://mynovanook.com">Explore NovaNook <ArrowIcon diagonal /></a>
              </div>
            </article>
          </section>

          <section id="company" className="company-section" aria-labelledby="company-title">
            <div className="section-label"><span>THE COMPANY BEHIND THE APPS</span><span className="section-rule" /></div>
            <div className="company-grid">
              <div className="company-copy">
                <p className="eyebrow">Hello, we’re Geofox.</p>
                <h2 id="company-title">Small details.<br />More possibilities.</h2>
                <p>GEOFOX APPS LLC is an independent software company and the creator of NovaNook. We bring practical tools and personal expression together, with care for how an app looks, feels, and fits into your day.</p>
                <p>NovaNook is our first chapter. This is the place to discover what we make next—and find help along the way.</p>
              </div>
              <aside className="support-card" aria-labelledby="support-title">
                <span className="support-icon" aria-hidden="true">
                  <svg viewBox="0 0 32 32" fill="none"><path d="M8 24 4 28V8a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H8Z" /><path d="M10 11h12M10 17h8" /></svg>
                </span>
                <p className="eyebrow">A little help, right here</p>
                <h2 id="support-title">Let’s find your<br />next step.</h2>
                <p>Looking for help with a Geofox app? Start with our support center to find the right place to go.</p>
                <a className="button button-secondary" href="/support">Visit support center <ArrowIcon /></a>
              </aside>
            </div>
          </section>
        </main>

        <footer className="site-footer">
          <div className="footer-company"><span className="footer-mark"><FoxMark /></span><p>GEOFOX APPS LLC<span>Thoughtful apps for everyday interests.</span></p></div>
          <div className="footer-links"><a href="/support">Support</a><a href="/admin">Staff access <ArrowIcon diagonal /></a></div>
          <p className="copyright">© {new Date().getFullYear()} GEOFOX APPS LLC. All rights reserved.</p>
        </footer>
      </div>
    </>
  );
}
