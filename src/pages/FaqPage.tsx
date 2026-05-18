import Seo from "@/components/Seo";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is Erys?",
    a: "Erys is a community token launchpad on Solana. Contributors pool SOL together before a token launches, so every participant gets in at the same price from block one.",
  },
  {
    q: "How is Erys different from Pump.fun?",
    a: "On Pump.fun, tokens launch into an open market where bots can snipe the first block. On Erys, the community pool executes a single coordinated buy at launch — the community buy is the first buy, eliminating the sniper window.",
  },
  {
    q: "What is the minimum contribution?",
    a: "The minimum contribution per participant is 0.1 SOL.",
  },
  {
    q: "What happens if a launch doesn't reach its target?",
    a: "If the minimum raise threshold of 0.3 SOL is not met, the launch is cancelled automatically and all contributors receive a proportional refund.",
  },
  {
    q: "How are tokens distributed?",
    a: "Tokens are distributed proportionally based on each contributor's share of the total pool. If you contributed 10% of the pool, you receive 10% of the tokens.",
  },
  {
    q: "Can I see how much others have contributed before I commit?",
    a: "No. Contributors do not have visibility into the total pool size before the launch executes. This prevents strategic late contributions and keeps the process fair.",
  },
  {
    q: "What is a sponsored launch?",
    a: "A sponsored launch starts at 0 SOL. The launch creator covers the deployment cost. Contributors still participate under the same fair launch rules.",
  },
  {
    q: "Does Erys take a position in launches?",
    a: "No. Erys does not seed or take a position in any launch. The platform does not hold tokens on behalf of contributors.",
  },
  {
    q: "What wallets are supported?",
    a: "[Leave this for Curwin to fill in based on current wallet integrations.]",
  },
  {
    q: "Where are tokens launched?",
    a: "Tokens are launched on Pump.fun and Bags.fm.",
  },
];

const FaqPage = () => {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: {
        "@type": "Answer",
        text: typeof a === "string" ? a : "",
      },
    })),
  };

  return (
    <main className="min-h-screen">
      <Seo
        title="Frequently Asked Questions — Erys"
        description="Answers to common questions about Erys: community pooling, minimum contributions, refunds, sponsored launches, and how the launchpad works."
        path="/faq"
        jsonLd={jsonLd}
      />
      <article className="container mx-auto max-w-3xl px-4 py-16">
        <header className="mb-10 border-b border-border pb-6">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Learn
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Frequently Asked Questions
          </h1>
        </header>

        <Accordion type="multiple" className="w-full">
          {FAQS.map(({ q, a }, i) => (
            <AccordionItem key={i} value={`item-${i}`} className="border-border">
              <AccordionTrigger className="text-left text-base font-semibold text-foreground hover:no-underline">
                <h2 className="text-base font-semibold">{q}</h2>
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                {a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </article>
    </main>
  );
};

export default FaqPage;