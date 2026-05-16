import { formatSol, MIN_RAISE_LAMPORTS, MIN_RAISE_SOL } from "@/lib/constants";
import { Check, Coins, Users } from "lucide-react";

interface LaunchStatsProps {
  totalEscrow: number;
  contributorCount: number;
  /**
   * On-chain escrow wallet balance in lamports. When provided, this is the
   * source of truth for the displayed raise (so SOL that landed on-chain
   * but hasn't been recorded yet is still visible).
   */
  onChainLamports?: number | null;
}

const LaunchStats = ({ totalEscrow, contributorCount, onChainLamports }: LaunchStatsProps) => {
  const displayed =
    typeof onChainLamports === "number" && onChainLamports > totalEscrow
      ? onChainLamports
      : totalEscrow;
  const pendingLamports =
    typeof onChainLamports === "number" && onChainLamports > totalEscrow
      ? onChainLamports - totalEscrow
      : 0;
  const thresholdReached = displayed >= MIN_RAISE_LAMPORTS;
  const pct = Math.min(100, (displayed / MIN_RAISE_LAMPORTS) * 100);

  return (
  <div className="grid grid-cols-2 gap-4">
    <div className="border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Coins className="h-4 w-4 text-primary" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Presale Raise (SOL)</span>
      </div>
      <p className="mt-2 font-mono text-2xl font-bold text-foreground">{formatSol(displayed)}</p>
      {pendingLamports > 0 && (
        <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {formatSol(pendingLamports)} pending
        </p>
      )}
      <div className="mt-3 space-y-1">
        <div className="h-1 w-full bg-border">
          <div
            className={`h-full ${thresholdReached ? "bg-success" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
          {thresholdReached ? (
            <>
              <Check className="h-3 w-3 text-success" />
              <span>Min raise met</span>
            </>
          ) : (
            <span>
              Min to launch: <span className="font-mono text-foreground">{MIN_RAISE_SOL} SOL</span>
            </span>
          )}
        </div>
      </div>
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
};

export default LaunchStats;
