import { Link } from "react-router-dom";
import Seo from "@/components/Seo";

const HowItWorksPage = () => {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "How Community Pooling Works",
    description:
      "Erys is a community token launchpad where contributors pool SOL together before a token launches. Every participant gets in at the same price from block one.",
    mainEntityOfPage: "https://erys.live/how-it-works",
  };

  return (
    <main className="min-h-screen">
      <Seo
        title="How Community Pooling Works — Erys"
        description="How Erys community token launches work: pooled SOL, a single coordinated buy at launch, and proportional token distribution from block one."
        path="/how-it-works"
        jsonLd={jsonLd}
      />
      <article className="container mx-auto max-w-3xl px-4 py-16">
        <header className="mb-10 border-b border-border pb-6">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Learn
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            How Community Pooling Works
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Erys is a community token launchpad where contributors pool SOL together before a token
            launches. Every participant gets in at the same price from block one — no presales, no
            early access, no preferred allocations.
          </p>
        </header>

        <div className="space-y-10 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              The Problem With Traditional Launches
            </h2>
            <p>
              On most launchpads, bots and insiders buy tokens in the first block, before regular
              users can react. Automated snipers monitor mempools and execute purchases the instant
              liquidity is added, accumulating large positions at the lowest possible price. By the
              time a normal user sees the token and clicks buy, the price has already moved against
              them. This means early buyers get a dramatically lower price than everyone else, and
              the token is effectively rugged before the first candle prints.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">How Erys Works</h2>
            <ol className="space-y-3 list-decimal pl-5">
              <li>A launch is created with a target raise amount.</li>
              <li>Contributors send SOL to the launch pool during the contribution window.</li>
              <li>The minimum contribution is 0.1 SOL per contributor.</li>
              <li>
                The launch only proceeds if the pool reaches the 0.3 SOL minimum raise threshold.
              </li>
              <li>
                If the threshold is not met, all contributors are refunded proportionally and
                automatically.
              </li>
              <li>
                When the threshold is met, all pooled SOL is used to buy the token simultaneously in
                a single transaction at launch.
              </li>
              <li>
                Tokens are distributed to contributors proportionally based on their share of the
                pool.
              </li>
            </ol>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">Why This Matters</h2>
            <p>
              Every contributor holds tokens before the first candle prints. There is no window for
              snipers to front-run the community. The price at entry is the same for every
              participant regardless of when they contributed.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">Refund Logic</h2>
            <p>
              If a launch is cancelled or the minimum raise is not met, refunds are issued
              proportionally. Each contributor receives back the same percentage of the pool they
              put in.
            </p>
          </section>

          <section className="border-t border-border pt-6">
            <h2 className="mb-3 text-lg font-semibold text-foreground">Related Reading</h2>
            <ul className="space-y-2">
              <li>
                <Link to="/anti-sniper" className="text-foreground hover:text-primary">
                  How Erys Prevents Snipers →
                </Link>
              </li>
              <li>
                <Link to="/fair-launch" className="text-foreground hover:text-primary">
                  Fair Launch Mechanics →
                </Link>
              </li>
              <li>
                <Link to="/faq" className="text-foreground hover:text-primary">
                  FAQ →
                </Link>
              </li>
            </ul>
          </section>
        </div>
      </article>
    </main>
  );
};

export default HowItWorksPage;