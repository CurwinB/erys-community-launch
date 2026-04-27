import Seo from "@/components/Seo";

const LAST_UPDATED = "April 27, 2026";

const RiskPage = () => {
  return (
    <main className="min-h-screen">
      <Seo
        title="Risk Disclosure — Erys"
        description="Important risks associated with Solana token launches, escrow contributions, and using the Erys platform."
        path="/risk"
      />
      <article className="container mx-auto max-w-3xl px-4 py-16">
        <header className="mb-10 border-b border-border pb-6">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Legal
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Risk Disclosure
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
        </header>

        <div className="space-y-8 text-sm leading-relaxed text-muted-foreground">
          <div className="border border-destructive/40 bg-destructive/5 p-4 text-foreground">
            <p className="font-mono text-[11px] uppercase tracking-widest text-destructive">
              Important
            </p>
            <p className="mt-2 text-sm">
              Cryptocurrency tokens launched through Bags.fm or Pump.fun are highly speculative and
              may lose all value. Nothing on Erys is investment, legal, or tax advice. Only commit
              funds you can afford to lose entirely.
            </p>
          </div>

          <Section title="1. Volatility and total loss">
            Newly launched tokens are extremely volatile and frequently illiquid. Prices can move
            sharply within seconds and may go to zero. There is no guarantee of any return,
            liquidity, or secondary market.
          </Section>

          <Section title="2. Protocol and smart-contract risk">
            Bags.fm, Pump.fun, and the underlying Solana programs are third-party protocols. Bugs,
            exploits, governance changes, or upgrades on those protocols can cause loss of funds,
            failed transactions, or unexpected behavior. Erys does not control these protocols.
          </Section>

          <Section title="3. Solana network risk">
            The Solana network may experience downtime, congestion, dropped or skipped
            transactions, or validator-level issues. Such conditions may delay or prevent launches,
            contributions, or refunds.
          </Section>

          <Section title="4. Custodial escrow risk">
            Per-launch escrow keys are encrypted at rest with server-side secrets, and are used
            only to execute the corresponding launch or to refund contributors. Despite reasonable
            safeguards, no system is perfectly secure. A successful attack on our infrastructure
            could in theory result in loss of escrowed funds.
          </Section>

          <Section title="5. Refund mechanics">
            If a launch fails or is cancelled, contributions are refunded to the originating wallet
            less Solana network fees. Refund timing depends on Solana finality and platform
            conditions. We do not guarantee any specific refund window.
          </Section>

          <Section title="6. Sponsored and influencer slots">
            Sponsored launches may be coordinated with influencers who claim time slots
            independently. Influencers may hold positions, receive compensation, or have other
            interests in the tokens they promote that are not disclosed on Erys. Treat any
            promotional content as the personal views of the creator, not as advice from Erys.
          </Section>

          <Section title="7. Regulatory risk">
            The legal status of crypto assets, token launches, and decentralized markets varies by
            jurisdiction and is evolving. Participation may be restricted or prohibited where you
            live. You are solely responsible for compliance with applicable laws, including tax
            laws.
          </Section>

          <Section title="8. Operational risk">
            The Service depends on third-party providers (RPCs, hosting, wallet auth). Outages,
            misconfiguration, or human error can affect the timing or outcome of a launch.
          </Section>

          <Section title="9. No advice">
            Information on the Service is provided for informational purposes only. It is not, and
            should not be construed as, financial, investment, legal, or tax advice. Consult
            qualified professionals before making any decision involving crypto assets.
          </Section>

          <Section title="10. Acknowledgement">
            By using the Service, you acknowledge that you have read and understood the risks
            described here, that you accept these risks, and that Erys is not responsible for any
            losses you incur.
          </Section>
        </div>
      </article>
    </main>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section>
    <h2 className="mb-2 text-base font-semibold text-foreground">{title}</h2>
    <p>{children}</p>
  </section>
);

export default RiskPage;