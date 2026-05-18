import { Link } from "react-router-dom";
import Seo from "@/components/Seo";

const FairLaunchPage = () => {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Fair Launch Mechanics",
    description:
      "A fair launch means every participant enters at the same price with no special access granted to any individual, team, or bot.",
    mainEntityOfPage: "https://erys.live/fair-launch",
  };

  return (
    <main className="min-h-screen">
      <Seo
        title="Fair Launch Mechanics — Erys"
        description="Erys fair launch rules: no presale, no platform seed, no insider wallets, proportional distribution, and the same entry price for every contributor."
        path="/fair-launch"
        jsonLd={jsonLd}
      />
      <article className="container mx-auto max-w-3xl px-4 py-16">
        <header className="mb-10 border-b border-border pb-6">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Learn
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Fair Launch Mechanics
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            A fair launch means every participant enters at the same price with no special access
            granted to any individual, team, or bot. Erys is built around this principle at the
            protocol level.
          </p>
        </header>

        <div className="space-y-10 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">What Makes a Launch Unfair</h2>
            <p className="mb-3">Most token launches are unfair in one or more of the following ways:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Presale allocations give early buyers a lower price before public launch.</li>
              <li>Team or insider wallets receive tokens before the public.</li>
              <li>Bots snipe the first block, front-running regular buyers.</li>
              <li>Whales can buy disproportionately large positions at launch price.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">Erys Fair Launch Rules</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong className="text-foreground">No presale:</strong> there is no pre-launch
                allocation phase.
              </li>
              <li>
                <strong className="text-foreground">No platform seed:</strong> Erys does not take a
                position in any launch.
              </li>
              <li>
                <strong className="text-foreground">No insider wallets:</strong> the launchpad does
                not hold or receive tokens on behalf of any party.
              </li>
              <li>
                <strong className="text-foreground">Proportional distribution:</strong> every
                contributor receives tokens in exact proportion to their share of the pool.
              </li>
              <li>
                <strong className="text-foreground">Same entry price:</strong> because all funds
                are deployed in a single transaction, the effective entry price is identical for
                all contributors.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">Minimum Thresholds</h2>
            <p>
              To protect contributors, Erys enforces a minimum contribution of 0.1 SOL per
              participant and a minimum raise of 0.3 SOL per launch. If the raise threshold is not
              met, the launch is cancelled automatically and all funds are returned proportionally.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">Sponsored Launches</h2>
            <p>
              Erys supports sponsored launches that start at 0 SOL. In a sponsored launch, the
              launch creator covers the cost of the token deployment. Contributors still
              participate under the same fair launch rules — proportional distribution, same entry
              price, same refund protections.
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
                <Link to="/anti-sniper" className="text-foreground hover:text-primary">
                  How Erys Prevents Snipers →
                </Link>
              </li>
            </ul>
          </section>
        </div>
      </article>
    </main>
  );
};

export default FairLaunchPage;