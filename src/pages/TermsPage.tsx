import Seo from "@/components/Seo";

const LAST_UPDATED = "April 27, 2026";

const TermsPage = () => {
  return (
    <main className="min-h-screen">
      <Seo
        title="Terms of Service — Erys"
        description="The terms governing your use of Erys, the community launch platform for Solana tokens on Bags.fm and Pump.fun."
        path="/terms"
      />
      <article className="container mx-auto max-w-3xl px-4 py-16">
        <header className="mb-10 border-b border-border pb-6">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Legal
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
        </header>

        <div className="space-y-8 text-sm leading-relaxed text-muted-foreground">
          <Section title="1. Acceptance of terms">
            By accessing or using erys.live (the "Service"), you agree to be bound by these Terms of
            Service. If you do not agree, do not use the Service. Erys ("we", "us") may update these
            terms at any time; continued use after changes constitutes acceptance.
          </Section>

          <Section title="2. What Erys is (and is not)">
            Erys is a non-custodial scheduling and escrow tool that helps creators coordinate token
            launches on third-party protocols, including Bags.fm and Pump.fun. We do not issue,
            sell, custody, or control tokens. All token issuance and trading occurs on the
            underlying protocol. Erys is not a broker, dealer, exchange, investment adviser, or
            financial institution.
          </Section>

          <Section title="3. Eligibility">
            You represent that you are at least 18 years old, have full legal capacity to enter
            these terms, and are not a resident of, or located in, a jurisdiction where use of the
            Service or participation in token launches is prohibited or restricted (including any
            country or region subject to comprehensive sanctions). You are responsible for
            determining whether your use of the Service is lawful in your jurisdiction.
          </Section>

          <Section title="4. Wallets and accounts">
            You access the Service by connecting a self-custodied Solana wallet. You are solely
            responsible for safeguarding your wallet, seed phrase, and private keys. We cannot
            recover lost keys or reverse on-chain transactions. You are responsible for all
            activity that occurs through your wallet.
          </Section>

          <Section title="5. Escrow and contributions">
            Contributions sent to a launch are held in a per-launch escrow address until the launch
            executes or is cancelled. Escrow keys are encrypted at rest. If a launch fails to meet
            its conditions or is cancelled by the creator, contributions are refunded to the
            originating wallet, less network fees. Refund timing depends on Solana network
            conditions and on-chain finality. We do not guarantee any specific refund timeframe.
          </Section>

          <Section title="6. No guarantee of launch or value">
            We do not guarantee that any scheduled launch will succeed, that any token will list,
            achieve liquidity, or have any particular price. Tokens launched through Erys are
            highly speculative and may lose all value. Nothing on the Service is investment, legal,
            or tax advice.
          </Section>

          <Section title="7. Sponsored and influencer slots">
            Sponsored or influencer launch slots are made available on a first-come, first-served
            basis within platform capacity. Influencers who claim slots act independently. Erys
            does not endorse, verify, or assume responsibility for the conduct, statements, or
            tokens of any creator or influencer using the Service.
          </Section>

          <Section title="8. User responsibilities">
            You agree to: (a) verify all launch details before contributing; (b) comply with all
            applicable laws, including securities, anti-money-laundering, sanctions, and tax laws;
            (c) not use the Service to launder funds, evade sanctions, manipulate markets, defraud
            others, infringe intellectual property, impersonate any person, or distribute illegal
            content; and (d) not attempt to interfere with, reverse-engineer, or abuse the
            Service or its infrastructure.
          </Section>

          <Section title="9. Third-party services">
            The Service relies on third-party protocols and providers, including Bags.fm,
            Pump.fun, PumpPortal, Solana RPC providers, and wallet authentication providers. Your
            use of those services is governed by their own terms. We are not responsible for any
            act, omission, outage, or loss caused by a third-party service.
          </Section>

          <Section title="10. Fees">
            The Service may charge a processing fee per launch, disclosed before you commit. Solana
            network fees and any third-party platform fees are additional and outside our control.
          </Section>

          <Section title="11. Disclaimers">
            The Service is provided "as is" and "as available" without warranties of any kind,
            whether express, implied, or statutory, including warranties of merchantability,
            fitness for a particular purpose, non-infringement, accuracy, or uninterrupted
            operation. We do not warrant that the Service will be secure, error-free, or free from
            third-party interference.
          </Section>

          <Section title="12. Limitation of liability">
            To the maximum extent permitted by law, Erys and its operators will not be liable for
            any indirect, incidental, special, consequential, exemplary, or punitive damages, or
            for any loss of profits, revenue, data, tokens, or goodwill, arising from or related to
            your use of the Service. Our total aggregate liability for any claim relating to the
            Service will not exceed the greater of (a) fees you paid to Erys in the 30 days before
            the claim or (b) USD 100.
          </Section>

          <Section title="13. Indemnification">
            You agree to indemnify and hold harmless Erys, its operators, and affiliates from any
            claims, damages, liabilities, and expenses (including reasonable legal fees) arising
            from your use of the Service, your violation of these terms, or your violation of any
            law or third-party right.
          </Section>

          <Section title="14. Suspension and termination">
            We may suspend or terminate access to the Service at any time, with or without notice,
            for any reason, including suspected violation of these terms or applicable law.
            Sections that by their nature should survive termination will survive.
          </Section>

          <Section title="15. Governing law and disputes">
            These terms are governed by the laws of [Jurisdiction TBD], without regard to conflict
            of law principles. Any dispute arising from these terms or the Service will be resolved
            by binding arbitration seated in [Jurisdiction TBD], except that either party may seek
            injunctive relief in court for intellectual-property or unauthorized-access claims.
          </Section>

          <Section title="16. Contact">
            Questions about these terms? Email{" "}
            <a className="text-foreground hover:text-primary" href="mailto:info@erys.live">
              info@erys.live
            </a>
            .
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

export default TermsPage;