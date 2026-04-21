interface Props {
  platform: string;
}

const PlatformBadge = ({ platform }: Props) => {
  const isPump = platform === "pumpfun";
  return (
    <span
      className={`inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border rounded-none ${
        isPump
          ? "border-success text-success"
          : "border-primary text-primary"
      }`}
    >
      {isPump ? "Pump.fun" : "Bags"}
    </span>
  );
};

export default PlatformBadge;