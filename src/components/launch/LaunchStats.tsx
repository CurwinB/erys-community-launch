import { formatSol } from "@/lib/constants";
import { Coins, Users } from "lucide-react";

interface LaunchStatsProps {
  totalEscrow: number;
  contributorCount: number;
}

const LaunchStats = ({ totalEscrow, contributorCount }: LaunchStatsProps) => (
  <div className="grid grid-cols-2 gap-4">
    <div className="border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Coins className="h-4 w-4 text-primary" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">SOL in Escrow</span>
      </div>
      <p className="mt-2 font-mono text-2xl font-bold text-foreground">{formatSol(totalEscrow)}</p>
    </div>
    <div className="border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Contributors</span>
      </div>
      <p className="mt-2 font-mono text-2xl font-bold text-foreground">{contributorCount}</p>
    </div>
  </div>
);

export default LaunchStats;
