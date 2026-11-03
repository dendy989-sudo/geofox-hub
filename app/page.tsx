import Image from "next/image";
import { HomeAuthReturn } from "@/components/auth/home-auth-return";
import { GeofoxMark, Icon } from "@/components/admin/icons";
import "./home.css";

const novaBrandAssets = "/images/novanook";
const novaScreenshots = "https://www.mynovanook.com/assets/landing";

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
            <h1 id="hero-title">A little more<br /><span>possibility.</span><br />In your everyday.</h1>
            <p className="gf-hero-description">Thoughtful apps for the things you love. We bring useful tools and a personal touch to the interests that make life yours.</p>
            <div className="gf-hero-actions"><a className="gf-button" href="#apps">Explore our apps<Icon name="arrow" size={17} /></a><a className="gf-quiet-link" href="#company">Get to know Geofox<Icon name="chevron" size={14} /></a></div>
            <div className="gf-studio-note"><span className="gf-note-mark"><Icon name="layers" size={19} /></span><p><strong>Fresh ideas. Thoughtfully made.</strong><span>A home for every app we create.</span></p></div>
          </div>

          <article id="apps" className="gf-product" aria-labelledby="novanook-title">
            <div className="gf-product-brand">
              <Image className="gf-nova-icon" src={`${novaBrandAssets}/novanook-icon.svg`} alt="NovaNook app icon" width={407} height={435} unoptimized />
              <div><p className="gf-kicker">A GEOFOX APP</p><h2 id="novanook-title"><Image className="gf-nova-wordmark" src={`${novaBrandAssets}/novanook-wordmark-black.svg`} alt="NovaNook" width={1582} height={283} unoptimized /></h2></div>
            </div>
            <figure className="gf-product-preview">
              <a href={`${novaScreenshots}/wizard-grand-illustrated-night-fall.webp`} target="_blank" rel="noopener noreferrer" aria-label="View full-size screenshot of NovaNook’s Wizard’s Keep library (opens in a new tab)">
                <Image src={`${novaScreenshots}/wizard-grand-illustrated-night-fall.webp`} alt="NovaNook’s Wizard’s Keep Grand library, with books on four shelves, glowing pumpkins, and a fireplace" width={2400} height={1600} sizes="(max-width: 760px) calc(100vw - 40px), (max-width: 1000px) 45vw, 530px" loading="eager" fetchPriority="high" />
              </a>
              <figcaption><span>Wizard’s Keep · Grand library view</span><Icon name="external" size={12} /></figcaption>
            </figure>
            <div className="gf-product-body">
              <p className="gf-product-tagline">Your books. Your reading world.</p>
              <p>NovaNook turns your book collection into a personal digital library. Organize your books, track your reading, and make it yours with themed rooms, companions, and rewards.</p>
              <ul className="gf-product-features" aria-label="NovaNook features"><li><Icon name="book" size={14} />Personal libraries</li><li><Icon name="calendar" size={14} />Reading tools</li><li><Icon name="layers" size={14} />Companions & rewards</li></ul>
              <a className="gf-product-link" href="https://www.mynovanook.com">Explore NovaNook<Icon name="external" size={16} /></a>
            </div>
          </article>
        </section>

        <section className="gf-showcase" aria-labelledby="showcase-title">
          <div className="gf-showcase-heading"><div><p className="gf-kicker">INSIDE NOVANOOK</p><h2 id="showcase-title">A library that feels like you.</h2></div><p>From a shelf of favorites to a whole room of stories. Choose your view, set the mood, and keep your books close.</p></div>
          <div className="gf-screenshot-grid">
            <figure className="gf-screenshot-card">
              <a className="gf-screenshot-link" href={`${novaScreenshots}/grid-illustrated-day-none.webp`} target="_blank" rel="noopener noreferrer" aria-label="View full-size screenshot of NovaNook’s Grid library (opens in a new tab)">
                <Image src={`${novaScreenshots}/grid-illustrated-day-none.webp`} alt="NovaNook’s Grid library showing an example book collection arranged cover-first on wooden shelves" width={2356} height={1276} sizes="(max-width: 760px) calc(100vw - 40px), 570px" />
                <span className="gf-view-shot">View screenshot<Icon name="external" size={13} /></span>
              </a>
              <figcaption><h3>Your collection, at a glance.</h3><p>Grid shelves put your book covers front and center, with colors and styles to make the view your own.</p></figcaption>
            </figure>
            <figure className="gf-screenshot-card">
              <a className="gf-screenshot-link" href={`${novaScreenshots}/belle-grand-illustrated-night-fall.webp`} target="_blank" rel="noopener noreferrer" aria-label="View full-size screenshot of NovaNook’s Enchanted Library (opens in a new tab)">
                <Image src={`${novaScreenshots}/belle-grand-illustrated-night-fall.webp`} alt="NovaNook’s Enchanted Library in Grand view, with gilded bookshelves, red roses, a chandelier, and autumn decorations" width={2400} height={1600} sizes="(max-width: 760px) calc(100vw - 40px), 570px" />
                <span className="gf-view-shot">View screenshot<Icon name="external" size={13} /></span>
              </a>
              <figcaption><h3>Step into your favorite room.</h3><p>Explore Small, Medium, Large, and Grand libraries, with illustrated or realistic styles, lighting, and seasonal details.</p></figcaption>
            </figure>
          </div>
          <p className="gf-preview-note">Actual NovaNook app views with an example library. Additional themes and seasonal customization are part of Pro.</p>
        </section>

        <section className="gf-principles" aria-labelledby="features-title">
          <div className="gf-section-heading"><p className="gf-kicker">MORE THAN A BOOKSHELF</p><h2 id="features-title">Make room for every part of reading.</h2></div>
          <div className="gf-principle-grid">
            <article className="gf-principle"><span className="gf-principle-icon"><Icon name="book" size={21} /></span><h3>Keep your books organized</h3><p>Build collections and keep track of what you’re reading, what you’ve finished, and what’s next.</p></article>
            <article className="gf-principle"><span className="gf-principle-icon gf-cyan"><Icon name="calendar" size={21} /></span><h3>Build your reading rhythm</h3><p>Start a reading timer, record page progress, and follow your streaks and monthly reading stats.</p></article>
            <article className="gf-principle"><span className="gf-principle-icon gf-green"><Icon name="layers" size={21} /></span><h3>Companions & rewards</h3><p>Earn coins through reading streaks and marathons, then unlock companions and outfits for your nook.</p></article>
            <article className="gf-principle"><span className="gf-principle-icon gf-blue"><Icon name="users" size={21} /></span><h3>Share your reading world</h3><p>Follow fellow readers, explore their shelves, and share your own reading updates with the community.</p></article>
          </div>
        </section>

        <section id="company" className="gf-company" aria-labelledby="company-title">
          <div className="gf-company-copy"><p className="gf-kicker">THE COMPANY BEHIND THE APPS</p><h2 id="company-title">Hello, we’re Geofox.</h2><p>GEOFOX APPS LLC is the creator of NovaNook. We build digital experiences that bring practical tools and personal expression together.</p><p>NovaNook is our first chapter. We’re making room for what comes next.</p><div className="gf-company-signature"><span><GeofoxMark /></span><strong>GEOFOX APPS LLC<small>Thoughtful apps. Everyday possibilities.</small></strong></div></div>
          <aside className="gf-support" aria-labelledby="support-title"><span className="gf-support-icon"><Icon name="ticket" size={23} /></span><p className="gf-kicker">WE’RE HERE TO HELP</p><h2 id="support-title">Let’s find your<br />next step.</h2><p>Have a question about a Geofox app? Our support center brings you to the right place.</p><a className="gf-button" href="/support">Visit support center<Icon name="arrow" size={16} /></a><a className="gf-support-tickets" href="https://www.mynovanook.com/support.html">Already use NovaNook? View your tickets<Icon name="external" size={13} /></a></aside>
        </section>
      </main>

      <footer className="gf-footer"><div className="gf-container gf-footer-inner"><a className="gf-brand gf-footer-brand" href="/" aria-label="Geofox Apps home"><span className="gf-brand-mark"><GeofoxMark /></span><span>geofox <span className="gf-brand-suffix">apps</span></span></a><nav aria-label="Footer navigation"><a href="#apps">Our apps</a><a href="/support">Support</a><a href="/admin/login">Staff sign in<Icon name="external" size={12} /></a></nav><p>© {new Date().getFullYear()} GEOFOX APPS LLC. All rights reserved.</p></div></footer>
    </div>
  );
}
