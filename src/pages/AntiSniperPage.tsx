import { Link } from "react-router-dom";
import Seo from "@/components/Seo";

const AntiSniperPage = () => {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "How Erys Prevents Snipers",
    description:
      "Sniping is the practice of buying a token in the first block before others can react. Erys eliminates the sniper window by architecture.",
    mainEntityOfPage: "https://erys.live/anti-sniper",
  };

  return (
    <main className="min-h-screen">
      <Seo
        title="How Erys Prevents Snipers — Anti-Sniper Design"
        description="Erys eliminates first-block sniping by replacing the open-market launch moment with a single coordinated community buy."
        path="/anti-sniper"
        jsonLd={jsonLd}
      />
      <article className="container mx-auto max-w-3xl px-4 py-16">
        <header className="mb-10 border-b border-border pb-6">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Learn
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            How Erys Prevents Snipers
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Sniping is the practice of buying a token in the first block of its launch, before
            other users can react. Snipers use bots to execute purchases faster than any human,
            giving them a lower average entry price than the rest of the market. Erys eliminates
            this by design.
          </p>
        </header>

        <div className="space-y-10 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              Why Sniping Happens on Traditional Launchpads
            </h2>
            <p>
              On platforms like Pump.fun, tokens are launched into an open market. The moment
              liquidity is added, bots execute buy transactions faster than humans can. By the time
              a regular user sees the token and buys, snipers have already accumulated a position
              at a fraction of the price.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">The Erys Approach</h2>
            <p>
              Erys does not launch tokens into an open market immediately. Instead, a community
              pools SOL before the launch. When the pool is ready, a single coordinated buy
              transaction is executed using all pooled funds simultaneously. There is no open
              window between token creation and the community buy — the community IS the launch.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              What This Means for Contributors
            </h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>No bot can buy before the community, because the community buy is the first buy.</li>
              <li>Every contributor gets the same effective entry price.</li>
              <li>Token distribution is proportional to each contributor's share of the pool.</li>
              <li>Contributors hold tokens before the first candle prints on any chart.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">Is This Truly Sniper-Proof?</h2>
            <p>
              The architecture removes the sniper opportunity at the most critical moment: the
              first block. After the community buy, the token trades freely and normal market
              dynamics apply. Erys does not control secondary market activity — it only guarantees
              that the launch itself is fair.
            </p>
          </section>

          <section className="border-t border-border pt-6">
            <h2 className="mb-3 text-lg font-semibold text-foreground">Related Reading</h2>
            <ul className="space-y-2">
              <li>
                <Link to="/how-it-works" className="text-foreground hover:text-primary">
                  How Community Pooling Works →
                </Link>
              </li>
              <li>
                <Link to="/fair-launch" className="text-foreground hover:text-primary">
                  Fair Launch Mechanics →
                </Link>
              </li>
            </ul>
          </section>
        </div>
      </article>
    </main>
  );
};

export default AntiSniperPage;