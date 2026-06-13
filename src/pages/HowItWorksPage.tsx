import { Link } from "react-router-dom";
import { ArrowLeftRight, Eye, Lock, ShieldCheck } from "lucide-react";
import Seo from "@/components/Seo";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const steps = [
  {
    label: "Step 1",
    title: "Developer creates a launch page",
    body: "The developer sets a token name, ticker, target raise in SOL, and a launch time. The page is live on Erys before the token exists on any blockchain.",
  },
  {
    label: "Step 2",
    title: "Contributors find the page and commit SOL",
    body: "Anyone can browse upcoming launches and contribute a minimum of 0.1 SOL. When you commit, your SOL moves into an on-chain escrow contract immediately. It does not go to the developer. It does not go to Erys. It sits in the contract until one of two things happens.",
  },
  {
    label: "Step 3",
    title: "The raise hits its target",
    body: "Once the total pool reaches the target raise amount before the scheduled launch time, the launch is ready to execute. Contributors are locked in.",
  },
  {
    label: "Step 4",
    title: "Block one — the pooled SOL executes",
    body: "At launch time, the pooled SOL hits Pump.fun or Bags.fm in a single coordinated transaction. The token is created and purchased simultaneously. Every contributor receives tokens proportional to their share of the pool — at the same moment, the same price, the first trade that token has ever seen.",
  },
  {
    label: "From here",
    title: "The token is live — your position exists from the very start",
    body: "The chart begins. Contributors hold tokens from block one. Whatever the token does from this point — every move is captured from the earliest possible entry.",
    outcome: true,
  },
];

const mechanics = [
  {
    icon: Lock,
    title: "Locked on-chain",
    body: "Your SOL is held in a Solana smart contract from the moment you contribute. Verifiable on-chain at any time.",
  },
  {
    icon: ShieldCheck,
    title: "No admin access",
    body: "There is no function in the contract that allows Erys or the developer to withdraw contributor SOL before launch.",
  },
  {
    icon: ArrowLeftRight,
    title: "Two outcomes only",
    body: "The contract executes the launch or it returns your SOL. There is no third path.",
  },
  {
    icon: Eye,
    title: "Fully transparent",
    body: "Every contribution, every balance, and every execution is visible on the Solana blockchain in real time.",
  },
];

const faqs = [
  {
    q: "Can I withdraw my SOL after I contribute?",
    a: "Once you commit SOL to a raise, it is locked in the escrow contract until the raise completes or the window closes. If the raise fails, your SOL returns automatically. If the raise succeeds, it executes at launch. You cannot withdraw mid-raise. Only contribute what you are comfortable committing.",
  },
  {
    q: "Does Erys guarantee the token will perform?",
    a: "No. Erys coordinates your entry at block one — the earliest possible position. What the token does after that is determined by the market. Block one access is the advantage Erys provides. It is not a guarantee of any outcome. Memecoin trading carries significant financial risk including total loss of capital.",
  },
  {
    q: "What is the minimum contribution?",
    a: "0.1 SOL per launch. There is no maximum, though individual launches may set their own contribution limits.",
  },
  {
    q: "Can the developer see who contributed?",
    a: "All contributions are on-chain and publicly visible — wallet addresses and amounts are transparent to anyone, including the developer. This is a property of how Solana works, not a choice Erys makes.",
  },
  {
    q: "What happens if the developer cancels?",
    a: "If a launch does not execute by its scheduled time for any reason, the escrow contract treats it as a failed raise and returns all SOL to contributors automatically.",
  },
  {
    q: "Does Erys hold my SOL at any point?",
    a: "No. Your SOL moves from your wallet directly into the on-chain escrow contract. Erys never has custody of contributor funds at any point in the process.",
  },
];

const Callout = ({ children }: { children: React.ReactNode }) => (
  <div className="border-l-2 border-primary bg-muted/50 p-4 text-sm leading-relaxed text-muted-foreground">
    {children}
  </div>
);

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mb-4 text-2xl font-semibold tracking-tight text-foreground">{children}</h2>
);

const HowItWorksPage = () => {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "How Erys Works",
    description:
      "Erys is a coordination layer for Solana token launches. Contributors pool SOL into an on-chain escrow contract before the token exists, and execute as a single block-one buy on Pump.fun or Bags.fm.",
    mainEntityOfPage: "https://erys.live/how-it-works",
  };

  return (
    <main className="min-h-screen">
      <Seo
        title="How Erys Works — Block-One Token Launches"
        description="How Erys works: pooled SOL in an on-chain escrow contract, a single coordinated block-one buy on Pump.fun or Bags.fm, and automatic refunds if the raise does not complete."
        path="/how-it-works"
        jsonLd={jsonLd}
      />
      <article className="container mx-auto max-w-3xl px-4 py-16">
        <header className="mb-12 border-b border-border pb-8">
          <p className="font-mono text-[11px] uppercase tracking-widest text-primary">Learn</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            How Erys Works
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Erys is a coordination layer for Solana token launches. Contributors commit SOL into an
            on-chain escrow before the token exists, then execute together as a single block-one buy
            on Pump.fun or Bags.fm.
          </p>
        </header>

        <div className="space-y-14">
          {/* Section 1 */}
          <section>
            <SectionHeading>What happens from the moment you find a launch</SectionHeading>
            <p className="mb-8 text-sm leading-relaxed text-muted-foreground">
              Every launch on Erys starts before the token exists anywhere. A developer creates a
              launch page — setting a ticker, a target raise amount, and a scheduled launch time.
              That page goes live on Erys immediately. From that moment, anyone can find it, review
              it, and decide whether to contribute.
            </p>

            <ol className="relative space-y-8 border-l border-border pl-8">
              {steps.map((s) => (
                <li key={s.label} className="relative">
                  <span
                    className={`absolute -left-[35px] top-1.5 h-3 w-3 rounded-full border-2 border-background ${
                      s.outcome ? "bg-muted-foreground" : "bg-primary"
                    }`}
                  />
                  <p
                    className={`font-mono text-[11px] uppercase tracking-widest ${
                      s.outcome ? "text-muted-foreground" : "text-primary"
                    }`}
                  >
                    {s.label}
                  </p>
                  <h3 className="mt-1 text-base font-semibold text-foreground">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* Section 2 */}
          <section className="border-t border-border pt-10">
            <SectionHeading>Where your SOL actually sits</SectionHeading>
            <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
              When you contribute to a launch on Erys, your SOL does not go to the developer and it
              does not go to Erys. It moves into a smart contract on Solana — a self-executing
              piece of code with one job: hold the SOL until the raise completes, then release it
              to the launch, or return it if the raise fails.
            </p>
            <Callout>
              Nobody can touch it. Not the developer. Not the Erys team. Not any third party. The
              contract has no admin override. The only two outcomes coded into it are: execute the
              launch, or refund the contributors. Nothing else can happen to your SOL.
            </Callout>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {mechanics.map((m) => {
                const Icon = m.icon;
                return (
                  <div key={m.title} className="border border-border bg-card p-4">
                    <Icon className="mb-3 h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">{m.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{m.body}</p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Section 3 */}
          <section className="border-t border-border pt-10">
            <SectionHeading>What block one actually means</SectionHeading>
            <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
              On Pump.fun and Bags.fm, a token does not exist until someone creates and buys it in
              the same transaction. Block one is that transaction — the very first moment the token
              exists on the blockchain and the very first price it has ever traded at.
            </p>
            <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
              When an Erys raise completes, all pooled SOL executes as a single coordinated buy at
              that first moment. Every contributor enters at the same price because there is no
              earlier price. There is no pre-sale, no insider allocation, no dev wallet that bought
              before you. The pool hits the chain together.
            </p>
            <Callout>
              Every trade that happens after block one is at a higher price than yours. Every
              person who finds out about the token after launch, every CT post, every KOL mention —
              all of it happens after you were already in. You hold tokens from the very first
              transaction this token has ever had.
            </Callout>
          </section>

          {/* Section 4 */}
          <section className="border-t border-border pt-10">
            <SectionHeading>What happens if the raise does not complete</SectionHeading>
            <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
              If the total pool does not reach the target raise amount before the scheduled launch
              time, the launch does not execute. The smart contract automatically returns every
              contributor's SOL in full, proportionally, with no manual claim required on your
              part.
            </p>
            <Callout>
              You do not need to submit a request. You do not need to contact anyone. The contract
              returns your SOL to your wallet automatically when the raise window closes without
              hitting its target.
            </Callout>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Erys does not hold refunded SOL. It moves directly from the contract back to each
              contributor's wallet.
            </p>
          </section>

          {/* Section 5 */}
          <section className="border-t border-border pt-10">
            <SectionHeading>Pump.fun and Bags.fm</SectionHeading>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
              Erys coordinates launches that execute on one of two Solana token launchpads. The
              developer chooses which platform their token launches on when they create their Erys
              launch page.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="border border-border bg-card p-4">
                <span className="inline-block rounded-none border border-success px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-success">
                  Pump.fun
                </span>
                <h3 className="mt-3 text-sm font-semibold text-foreground">Pump.fun</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  One of the largest memecoin launchpads on Solana. Tokens launch with a bonding
                  curve mechanism and graduate to PumpSwap once they reach a market cap threshold.
                </p>
              </div>
              <div className="border border-border bg-card p-4">
                <span className="inline-block rounded-none border border-primary px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-primary">
                  Bags.fm
                </span>
                <h3 className="mt-3 text-sm font-semibold text-foreground">Bags.fm</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  A Solana token launchpad with a creator fee share model, meaning developers earn
                  ongoing fees from trading volume on their token. Designed to align developer and
                  community incentives.
                </p>
              </div>
            </div>

            <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
              Erys does not operate either platform. When a raise completes, your SOL executes
              directly through the platform the developer selected. Erys is the coordination layer
              before launch — everything after block one happens on the platform itself.
            </p>
          </section>

          {/* Section 6 */}
          <section className="border-t border-border pt-10">
            <SectionHeading>Things people usually ask</SectionHeading>
            <Accordion type="multiple" className="w-full">
              {faqs.map((f, i) => (
                <AccordionItem key={i} value={`q-${i}`} className="border-border">
                  <AccordionTrigger className="text-left text-sm font-medium text-foreground hover:no-underline">
                    {f.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                    {f.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>

          {/* CTA */}
          <section className="border border-border bg-card p-8 text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              Ready to find a launch?
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              Browse upcoming launches and get in before the token exists anywhere else.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link to="/">
                <Button size="sm">Browse launches</Button>
              </Link>
              <Link to="/schedule">
                <Button size="sm" variant="ghost">
                  Schedule a launch
                </Button>
              </Link>
            </div>
          </section>

          <p className="text-xs leading-relaxed text-muted-foreground">
            Erys is a coordination tool. Participating in any token launch carries significant
            financial risk including total loss of capital. Erys does not guarantee any token's
            performance. Not financial advice.
          </p>
        </div>
      </article>
    </main>
  );
};

export default HowItWorksPage;