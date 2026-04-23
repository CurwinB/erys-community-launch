const bagsSteps = [
  {
    step: "1",
    title: "Contribute SOL",
    body: "Send SOL to the escrow before launch. Your share is proportional to how much you contribute.",
  },
  {
    step: "2",
    title: "Receive Tokens",
    body: "When the token launches you automatically receive tokens proportional to your contribution. The more SOL you put in the more tokens you get.",
  },
  {
    step: "3",
    title: "Earn Trading Fees Forever",
    body: "You are registered as a permanent on-chain fee share recipient. Every trade earns you fees proportional to your contribution. Forever.",
  },
];

const pumpfunSteps = [
  {
    step: "1",
    title: "Contribute SOL",
    body: "Send SOL to the escrow before launch. Your share is proportional to how much you contribute.",
  },
  {
    step: "2",
    title: "Receive Tokens at Launch Price",
    body: "When the token launches you automatically receive tokens proportional to your contribution. You get in at the earliest possible price before anyone else can buy.",
  },
  {
    step: "3",
    title: "Early Entry Advantage",
    body: "Your tokens are in your wallet the moment the launch executes. No waiting, no claiming. The earlier you get in the more tokens you receive for the same SOL.",
  },
];

interface HowItWorksProps {
  platform: string;
}

const HowItWorks = ({ platform }: HowItWorksProps) => {
  const steps = platform === "pumpfun" ? pumpfunSteps : bagsSteps;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {steps.map((s) => (
        <div key={s.step} className="flex items-start gap-3 border border-border bg-card p-4">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-sm bg-primary font-mono text-xs font-bold text-primary-foreground">
            {s.step}
          </span>
          <div>
            <h4 className="text-sm font-semibold text-foreground">{s.title}</h4>
            <p className="text-xs text-muted-foreground">{s.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default HowItWorks;
