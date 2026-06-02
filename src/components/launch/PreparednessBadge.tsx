import type { PreparednessTier } from "@/lib/preparedness";
import { ShieldCheck, Clock } from "lucide-react";

interface Props {
  tier: PreparednessTier;
  size?: "sm" | "md";
  className?: string;
}

const PreparednessBadge = ({ tier, size = "md", className = "" }: Props) => {
  if (tier === "none") return null;

  const isPrepared = tier === "prepared";
  const Icon = isPrepared ? ShieldCheck : Clock;
  const label = isPrepared ? "Prepared Launch" : "In Progress";

  const tone = isPrepared
    ? "border-success/40 bg-success/10 text-success"
    : "border-yellow-500/40 bg-yellow-500/10 text-yellow-400";

  const sizing =
    size === "sm"
      ? "px-1.5 py-0.5 text-[9px] gap-1"
      : "px-2 py-0.5 text-[10px] gap-1.5";

  return (
    <span
      className={`inline-flex items-center rounded-sm border font-semibold uppercase tracking-wider ${tone} ${sizing} ${className}`}
      title={label}
    >
      <Icon className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />
      {label}
    </span>
  );
};

export default PreparednessBadge;