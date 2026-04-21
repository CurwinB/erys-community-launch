import { Card } from "@/components/ui/card";
import { formatSolNumber, formatInt } from "@/lib/adminFormat";
import { Coins, Rocket, Activity, Users } from "lucide-react";

interface Props {
  totalRevenueSol: number;
  totalLaunches: number;
  activeLaunches: number;
  totalContributors: number;
  loading?: boolean;
}

const MetricCard = ({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}) => (
  <Card className="rounded-none bg-card border-border p-5">
    <div className="flex items-center justify-between mb-3">
      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <Icon className={`h-4 w-4 ${accent}`} />
    </div>
    <div className="font-mono text-2xl font-bold text-foreground">{value}</div>
  </Card>
);

const MetricCards = ({
  totalRevenueSol,
  totalLaunches,
  activeLaunches,
  totalContributors,
  loading,
}: Props) => {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <MetricCard
        label="Platform Revenue (SOL)"
        value={loading ? "—" : formatSolNumber(totalRevenueSol)}
        icon={Coins}
        accent="text-primary"
      />
      <MetricCard
        label="Total Launches"
        value={loading ? "—" : formatInt(totalLaunches)}
        icon={Rocket}
        accent="text-foreground"
      />
      <MetricCard
        label="Active Launches"
        value={loading ? "—" : formatInt(activeLaunches)}
        icon={Activity}
        accent="text-success"
      />
      <MetricCard
        label="Total Contributors"
        value={loading ? "—" : formatInt(totalContributors)}
        icon={Users}
        accent="text-foreground"
      />
    </div>
  );
};

export default MetricCards;