const steps = [
  { step: "1", title: "Contribute SOL", body: "Send SOL to the escrow before launch." },
  { step: "2", title: "Token Launches", body: "Launches automatically at scheduled time." },
  { step: "3", title: "Earn Forever", body: "Earn Bags trading fees proportional to your contribution." },
];

const HowItWorks = () => (
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

export default HowItWorks;
