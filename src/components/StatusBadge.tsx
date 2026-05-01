import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: "scheduled" | "executing" | "launched" | "execution_failed" | "cancelled" | "sponsor_pending";
  className?: string;
}

const statusConfig = {
  scheduled: { label: "Presale Open", className: "border-primary/50 bg-primary/10 text-primary" },
   executing: { label: "Launching", className: "border-yellow-500/50 bg-yellow-500/10 text-yellow-400" },
  launched: { label: "Live on DEX", className: "border-success/50 bg-success/10 text-success" },
  execution_failed: { label: "Refund Available", className: "border-destructive/50 bg-destructive/10 text-destructive" },
  cancelled: { label: "Cancelled", className: "border-muted-foreground/50 bg-muted/50 text-muted-foreground" },
  sponsor_pending: { label: "Awaiting Details", className: "border-amber-500/50 bg-amber-500/10 text-amber-400" },
};

const StatusBadge = ({ status, className }: StatusBadgeProps) => {
  const config = statusConfig[status];
  return (
    <Badge
      variant="outline"
      className={cn("rounded-sm font-mono text-[10px] uppercase tracking-wider", config.className, className)}
    >
      {config.label}
    </Badge>
  );
};

export default StatusBadge;
