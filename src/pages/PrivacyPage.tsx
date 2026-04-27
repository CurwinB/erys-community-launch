import Seo from "@/components/Seo";

const LAST_UPDATED = "April 27, 2026";

const PrivacyPage = () => {
  return (
    <main className="min-h-screen">
      <Seo
        title="Privacy Policy — Erys"
        description="How Erys collects, uses, and protects information when you schedule and participate in Solana token launches."
        path="/privacy"
      />
      <article className="container mx-auto max-w-3xl px-4 py-16">
        <header className="mb-10 border-b border-border pb-6">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Legal
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
        </header>

        <div className="space-y-8 text-sm leading-relaxed text-muted-foreground">
          <Section title="1. Overview">
            This Privacy Policy explains what information Erys ("we", "us") collects when you use
            erys.live, how we use it, and your choices. By using the Service you consent to the
            practices described here.
          </Section>

          <Section title="2. Information we collect">
            <ul className="ml-5 list-disc space-y-1">
              <li>
                <strong className="text-foreground">Wallet data:</strong> public Solana wallet
                addresses you connect, on-chain transactions related to your launches and
                contributions, and signed messages used for authentication.
              </li>
              <li>
                <strong className="text-foreground">Launch metadata:</strong> token name, symbol,
                image, scheduled time, platform choice, contributor counts, and similar fields you
                submit.
              </li>
              <li>
                <strong className="text-foreground">Technical data:</strong> IP address,
                user-agent, device and browser information, and request logs, used for security and
                abuse prevention.
              </li>
              <li>
                <strong className="text-foreground">Communications:</strong> any information you
                send when you contact us at info@erys.live.
              </li>
              <li>
                <strong className="text-foreground">Auth metadata:</strong> data provided by our
                wallet authentication provider (Dynamic Labs) such as session identifiers.
              </li>
            </ul>
          </Section>

          <Section title="3. What we do not collect">
            We do not collect or store your wallet seed phrase or private keys. Per-launch escrow
            keys created by the Service are encrypted at rest using AES-256-GCM with server-side
            secrets and are used only to execute or refund the corresponding launch.
          </Section>

          <Section title="4. How we use information">
            We use information to operate, secure, and improve the Service; to execute scheduled
            launches and refunds; to detect fraud, abuse, and unauthorized access; to comply with
            legal obligations; and to respond to your inquiries.
          </Section>

          <Section title="5. Service providers">
            We share information with infrastructure and platform providers strictly to operate the
            Service, including: Supabase (database and edge functions), Dynamic Labs (wallet
            authentication), Solana RPC providers, and the launch platforms you choose (Bags.fm,
            Pump.fun, PumpPortal). Each provider is bound by its own privacy and security
            commitments.
          </Section>

          <Section title="6. On-chain data">
            Solana is a public blockchain. Any transaction associated with your wallet — including
            contributions, launches, and refunds — is publicly visible and outside our control. We
            cannot delete or modify on-chain records.
          </Section>

          <Section title="7. Cookies and storage">
            We use functional browser storage (such as localStorage and session cookies) only to
            maintain authentication and session state. We do not use third-party advertising
            cookies.
          </Section>

          <Section title="8. Data retention">
            Launch and contribution records are retained indefinitely for on-chain auditability and
            accounting integrity. Support emails are retained for up to 12 months after a request
            is resolved. Security logs are retained for as long as needed to investigate abuse.
          </Section>

          <Section title="9. Your rights">
            Depending on your jurisdiction you may have rights to access, correct, or delete
            personal information we hold, to object to or restrict certain processing, and to data
            portability. To exercise these rights, email{" "}
            <a className="text-foreground hover:text-primary" href="mailto:info@erys.live">
              info@erys.live
            </a>{" "}
            from the email associated with your request, or sign a message from the wallet tied to
            the records in question. Note that we cannot delete on-chain data.
          </Section>

          <Section title="10. Security">
            We use industry-standard safeguards including encrypted secret storage, role-based
            access controls, and Row-Level Security on user data. No system is perfectly secure;
            you use the Service at your own risk.
          </Section>

          <Section title="11. Children">
            The Service is not directed to anyone under 18, and we do not knowingly collect
            information from children.
          </Section>

          <Section title="12. International transfers">
            Information may be processed in countries other than your own. By using the Service you
            consent to such transfers.
          </Section>

          <Section title="13. Changes">
            We may update this Privacy Policy from time to time. We will update the "Last updated"
            date above and, where appropriate, provide additional notice.
          </Section>

          <Section title="14. Contact">
            Privacy questions? Email{" "}
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
    <div>{children}</div>
  </section>
);

export default PrivacyPage;