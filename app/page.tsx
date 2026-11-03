import { HomeAuthReturn } from "@/components/auth/home-auth-return";
import { GeofoxMark, Icon } from "@/components/admin/icons";
import "./home.css";

function BookArtwork() {
  return (
    <svg className="gf-book-artwork" viewBox="0 0 440 320" fill="none" aria-hidden="true">
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
    <div className="geofox-home">
      <HomeAuthReturn />
      <a className="gf-skip" href="#main-content">Skip to content</a>
      <header className="gf-header">
        <div className="gf-container gf-header-inner">
          <a className="gf-brand" href="/" aria-label="Geofox Apps home"><span className="gf-brand-mark"><GeofoxMark /></span><span>geofox <span className="gf-brand-suffix">apps</span></span></a>
          <nav className="gf-nav" aria-label="Main navigation"><a href="#apps">Our apps</a><a href="#company">Our company</a><a href="/support">Support</a></nav>
          <a className="gf-staff" href="/admin/login"><Icon name="lock" size={14} />Staff sign in<Icon name="arrow" size={14} /></a>
        </div>
      </header>

      <main id="main-content" className="gf-container" tabIndex={-1}>
        <section className="gf-hero" aria-labelledby="hero-title">
          <div className="gf-hero-copy">
            <p className="gf-studio-label"><span />INDEPENDENT APP STUDIO</p>
            <h1 id="hero-title">A little more<br /><span>possibility.</span><br />In your everyday.</h1>
            <p className="gf-hero-description">Thoughtful apps for the things you love. We bring useful tools and a personal touch to the interests that make life yours.</p>
            <div className="gf-hero-actions"><a className="gf-button" href="#apps">Explore our apps<Icon name="arrow" size={17} /></a><a className="gf-quiet-link" href="#company">Get to know Geofox<Icon name="chevron" size={14} /></a></div>
            <div className="gf-studio-note"><span className="gf-note-mark"><Icon name="layers" size={19} /></span><p><strong>Fresh ideas. Thoughtfully made.</strong><span>A home for every app we create.</span></p></div>
          </div>

          <article id="apps" className="gf-product" aria-labelledby="novanook-title">
            <div className="gf-product-topline"><span className="gf-kicker">OUR FIRST CHAPTER</span><span className="gf-category"><span />NovaNook</span></div>
            <div className="gf-product-art"><span className="gf-art-orbit gf-art-orbit-one" /><span className="gf-art-orbit gf-art-orbit-two" /><BookArtwork /><p>Your books. Your own little world.</p></div>
            <div className="gf-product-body">
              <div className="gf-product-heading"><div><p className="gf-kicker">FOR THE LOVE OF BOOKS</p><h2 id="novanook-title">Meet NovaNook.</h2></div><span className="gf-product-icon"><Icon name="book" size={23} /></span></div>
              <p>A personal library with a little magic. Organize your books, follow your reading journey, and create a space that feels like you.</p>
              <ul className="gf-product-features" aria-label="NovaNook features"><li><Icon name="book" size={14} />Your library</li><li><Icon name="calendar" size={14} />Reading goals</li><li><Icon name="layers" size={14} />Your own style</li></ul>
              <a className="gf-product-link" href="https://www.mynovanook.com">Explore NovaNook<Icon name="external" size={16} /></a>
            </div>
          </article>
        </section>

        <section className="gf-principles" aria-labelledby="principles-title">
          <div className="gf-section-heading"><p className="gf-kicker">THE GEOFOX APPROACH</p><h2 id="principles-title">Small details. A better everyday.</h2></div>
          <div className="gf-principle-grid">
            <article className="gf-principle"><span className="gf-principle-icon"><Icon name="grid" size={21} /></span><h3>Thoughtfully designed</h3><p>Useful tools, clear layouts, and care in the details you use every day.</p></article>
            <article className="gf-principle"><span className="gf-principle-icon gf-cyan"><Icon name="layers" size={21} /></span><h3>Room to make it yours</h3><p>Personal touches that turn an everyday tool into a space you enjoy.</p></article>
            <article className="gf-principle"><span className="gf-principle-icon gf-green"><Icon name="ticket" size={21} /></span><h3>Help, close at hand</h3><p>A clear place to ask a question, find your next step, and keep in touch.</p></article>
          </div>
        </section>

        <section id="company" className="gf-company" aria-labelledby="company-title">
          <div className="gf-company-copy"><p className="gf-kicker">THE COMPANY BEHIND THE APPS</p><h2 id="company-title">Hello, we’re Geofox.</h2><p>GEOFOX APPS LLC is an independent software company and the creator of NovaNook. We build digital experiences that bring practical tools and personal expression together.</p><p>NovaNook is our first chapter. We’re making room for what comes next.</p><div className="gf-company-signature"><span><GeofoxMark /></span><strong>GEOFOX APPS LLC<small>Thoughtful apps. Everyday possibilities.</small></strong></div></div>
          <aside className="gf-support" aria-labelledby="support-title"><span className="gf-support-icon"><Icon name="ticket" size={23} /></span><p className="gf-kicker">WE’RE HERE TO HELP</p><h2 id="support-title">Let’s find your<br />next step.</h2><p>Have a question about a Geofox app? Our support center brings you to the right place.</p><a className="gf-button" href="/support">Visit support center<Icon name="arrow" size={16} /></a><a className="gf-support-tickets" href="https://www.mynovanook.com/support.html">Already use NovaNook? View your tickets<Icon name="external" size={13} /></a></aside>
        </section>
      </main>

      <footer className="gf-footer"><div className="gf-container gf-footer-inner"><a className="gf-brand gf-footer-brand" href="/" aria-label="Geofox Apps home"><span className="gf-brand-mark"><GeofoxMark /></span><span>geofox <span className="gf-brand-suffix">apps</span></span></a><nav aria-label="Footer navigation"><a href="#apps">Our apps</a><a href="/support">Support</a><a href="/admin/login">Staff sign in<Icon name="external" size={12} /></a></nav><p>© {new Date().getFullYear()} GEOFOX APPS LLC. All rights reserved.</p></div></footer>
    </div>
  );
}
