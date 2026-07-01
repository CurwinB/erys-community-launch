import { Users } from "lucide-react";

interface Props {
  enabled?: boolean | null;
  size?: "sm" | "md";
  className?: string;
}

const CodevBadge = ({ enabled, size = "md", className = "" }: Props) => {
  if (!enabled) return null;

  const sizing =
    size === "sm"
      ? "px-1.5 py-0.5 text-[9px] gap-1"
      : "px-2 py-0.5 text-[10px] gap-1.5";

  return (
    <span
      className={`inline-flex items-center rounded-sm border border-primary/40 bg-primary/10 font-semibold uppercase tracking-wider text-primary ${sizing} ${className}`}
      title="Contributors can earn an ongoing share of this token's creator fees"
    >
      <Users className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />
      Co-dev fees
    </span>
  );
};

export default CodevBadge;
