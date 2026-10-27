import {
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  Globe2,
  Link2,
  ScanSearch,
  Search,
} from "lucide-react";
import landingCss from "@/client/styles/lunar-optimize.css?url";
import {
  LUNAR_MONTHLY_PRICE_USD,
  LUNAR_MONTHLY_USAGE_CREDIT_USD,
} from "@/shared/billing";

const capabilities = [
  {
    title: "Keyword research",
    description:
      "Explore search demand and related queries with provider-backed data.",
    icon: Search,
  },
  {
    title: "Rank tracking",
    description:
      "Monitor selected keywords for a project, location, and language.",
    icon: BarChart3,
  },
  {
    title: "Competitor insights",
    description: "Compare domains and discover the terms that shape a market.",
    icon: Globe2,
  },
  {
    title: "Backlinks",
    description:
      "Inspect referring links and domains from the connected data provider.",
    icon: Link2,
  },
  {
    title: "Site audits",
    description:
      "Crawl accessible pages and turn technical issues into a work queue.",
    icon: ScanSearch,
  },
  {
    title: "AI visibility",
    description:
      "Explore supported answer surfaces and keep observations distinct from estimates.",
    icon: Bot,
  },
] as const;

export const landingHead = () => ({
  meta: [
    { title: "Lunar Optimize | Search intelligence for the work ahead" },
    {
      name: "description",
      content:
        "Lunar Optimize brings keyword research, rank tracking, competitor research, backlinks, site audits, and AI visibility into one Project Lunar workspace.",
    },
  ],
  links: [{ rel: "stylesheet", href: landingCss }],
});

export function WelcomePage() {
  return (
    <main className="lo-page">
      <a className="lo-skip" href="#main-content">
        Skip to content
      </a>
      <header className="lo-header">
        <a
          className="lo-brand"
          href="/welcome"
          aria-label="Lunar Optimize home"
        >
          <span className="lo-mark" aria-hidden="true">
            ◐
          </span>
          <span>
            <strong>lunar</strong>
            <em>optimize</em>
          </span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#capabilities">Capabilities</a>
          <a href="#how-it-works">How it works</a>
          <a className="lo-header-signin" href="/sign-in">
            Sign in
          </a>
        </nav>
      </header>

      <section
        className="lo-hero"
        id="main-content"
        aria-labelledby="hero-title"
      >
        <div className="lo-orbit lo-orbit-one" aria-hidden="true" />
        <div className="lo-orbit lo-orbit-two" aria-hidden="true" />
        <div className="lo-hero-inner">
          <p className="lo-eyebrow">
            <span /> PROJECT LUNAR · SEARCH INTELLIGENCE
          </p>
          <h1 id="hero-title">
            Know what to improve.
            <br />
            <span>See what the data supports.</span>
          </h1>
          <p className="lo-hero-copy">
            Research a market, track your search presence, and turn site
            findings into a clear next step. Lunar Optimize keeps the source and
            freshness of each observation close to the decision it informs.
          </p>
          <div className="lo-actions">
            <a
              className="lo-button lo-button-primary"
              href="/sign-up?redirect=%2F"
            >
              Create your workspace <ArrowRight size={17} aria-hidden="true" />
            </a>
            <a className="lo-button lo-button-secondary" href="#capabilities">
              Explore the platform
            </a>
          </div>
          <p className="lo-hero-note">
            Provider data and usage credits vary by feature. Subscription terms
            appear before checkout.
          </p>
        </div>
        <div
          className="lo-preview"
          aria-label="Illustration of an evidence-led SEO workspace"
        >
          <div className="lo-preview-top">
            <span className="lo-preview-dot" /> PROJECT OVERVIEW <span>↗</span>
          </div>
          <div className="lo-preview-body">
            <div className="lo-preview-heading">
              <span>Search landscape</span>
              <span>DATA SOURCE · DATE</span>
            </div>
            <div className="lo-preview-bars" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="lo-preview-row">
              <span>
                <CheckCircle2 size={15} /> Observed signals
              </span>
              <span>Review source</span>
            </div>
            <div className="lo-preview-row">
              <span>
                <ScanSearch size={15} /> Site issues
              </span>
              <span>Prioritize fixes</span>
            </div>
            <div className="lo-preview-row">
              <span>
                <BarChart3 size={15} /> Tracked keywords
              </span>
              <span>Watch changes</span>
            </div>
          </div>
          <p>Illustrative interface · no sample rankings or traffic claims</p>
        </div>
      </section>

      <section
        className="lo-section"
        id="capabilities"
        aria-labelledby="capabilities-title"
      >
        <div className="lo-section-heading">
          <p className="lo-kicker">ONE WORKSPACE</p>
          <h2 id="capabilities-title">From research to action</h2>
          <p>
            Choose a project, connect the relevant sources, and work from the
            evidence available for that domain.
          </p>
        </div>
        <div className="lo-grid">
          {capabilities.map(({ title, description, icon: Icon }) => (
            <article className="lo-card" key={title}>
              <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        className="lo-section lo-process"
        id="how-it-works"
        aria-labelledby="process-title"
      >
        <div className="lo-section-heading">
          <p className="lo-kicker">A CLEAR START</p>
          <h2 id="process-title">Build a picture you can trust</h2>
        </div>
        <ol>
          <li>
            <span>01</span>
            <div>
              <h3>Add a domain</h3>
              <p>
                Create a project and choose the site you want to understand.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>Run the right research</h3>
              <p>
                Use provider-backed lookups and connect first-party sources when
                available.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Make the next move</h3>
              <p>
                Review timestamps, gaps, and findings before changing a page or
                campaign.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section
        className="lo-pricing lo-section"
        aria-labelledby="pricing-title"
      >
        <div className="lo-section-heading">
          <p className="lo-kicker">SIMPLE PRICING</p>
          <h2 id="pricing-title">One plan for the whole workflow</h2>
          <p>Enrollment will open after billing setup is complete.</p>
        </div>
        <div className="lo-price-card">
          <div>
            <p className="lo-price-name">Lunar Optimize</p>
            <p className="lo-price-amount">
              ${LUNAR_MONTHLY_PRICE_USD}
              <span>/month</span>
            </p>
            <p className="lo-price-detail">
              Includes ${LUNAR_MONTHLY_USAGE_CREDIT_USD.toFixed(2)} in metered
              data credits each month. Usage cost varies by feature; the
              workspace shows your remaining balance.
            </p>
          </div>
          <a className="lo-button lo-button-secondary" href="/subscribe">
            View enrollment status <ArrowRight size={17} aria-hidden="true" />
          </a>
        </div>
      </section>

      <section className="lo-final" aria-labelledby="final-title">
        <p className="lo-kicker">START WITH CLARITY</p>
        <h2 id="final-title">
          Your next search opportunity starts with better evidence.
        </h2>
        <a className="lo-button lo-button-primary" href="/sign-up?redirect=%2F">
          Create your workspace <ArrowRight size={17} aria-hidden="true" />
        </a>
      </section>
      <footer className="lo-footer">
        <span>
          © {new Date().getUTCFullYear()} Project Lunar · Lunar Optimize
        </span>
        <span>Data availability and freshness are shown in the product.</span>
      </footer>
    </main>
  );
}
