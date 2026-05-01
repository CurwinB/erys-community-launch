const bagsSteps = [
  {
    step: "1",
    title: "Ape In",
    body: "Send SOL to the presale escrow before it ends. Your allocation is pro-rata to your buy.",
  },
  {
    step: "2",
    title: "Get Your Allocation",
    body: "Tokens drop straight to your wallet the moment the presale migrates to Bags. No claim, no wait.",
  },
  {
    step: "3",
    title: "Earn Creator Fees Forever",
    body: "You're written on-chain as a permanent fee-share recipient. Every trade, every block, your wallet earns. Forever.",
  },
];

const pumpfunSteps = [
  {
    step: "1",
    title: "Ape In Early",
    body: "Send SOL to the presale escrow and lock in your spot before the bonding curve opens.",
  },
  {
    step: "2",
    title: "First-Block Entry",
    body: "Your allocation lands at the bottom of the bonding curve, before any public buy. The earliest possible entry on Pump.",
  },
  {
    step: "3",
    title: "No Claim, No Wait",
    body: "Tokens are in your wallet the second the presale migrates. Trade immediately — no claim flow, no delay.",
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
