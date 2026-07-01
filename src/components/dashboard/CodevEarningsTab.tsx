import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useWallet } from "@/hooks/useWallet";
import { formatSol } from "@/lib/constants";
import { formatDate } from "@/lib/adminFormat";
import { Users, ExternalLink, Loader2 } from "lucide-react";

interface CodevSeatRow {
  launch_id: string;
  token_name: string;
  token_symbol: string;
  token_mint_address: string | null;
  contribution_lamports: number;
  pending_lamports: number;
  paid_lamports: number;
  joined_at: string;
  codev_mode: "proportional" | "fcfs";
  roster_locked_at: string | null;
}

interface CodevPayoutRow {
  launch_id: string;
  token_symbol: string;
  amount_lamports: number;
  tx_signature: string;
  created_at: string;
}

interface CodevDashboard {
  ok: boolean;
  wallet: string;
  seats: CodevSeatRow[];
  recent_payouts: CodevPayoutRow[];
}

const CodevEarningsTab = () => {
  const { publicKey } = useWallet();

  const { data, isLoading } = useQuery({
    queryKey: ["codev-dashboard", publicKey],
    enabled: !!publicKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("codev_dashboard", {
        p_wallet: publicKey!,
      });
      if (error) throw error;
      return data as unknown as CodevDashboard;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const seats = data?.seats ?? [];
  const recentPayouts = data?.recent_payouts ?? [];

  if (seats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-sm border border-dashed border-border py-12">
        <Users className="mb-3 h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">No co-dev seats yet</p>
        <p className="mt-1 max-w-sm text-center text-xs text-muted-foreground">
          Ape into a presale with co-dev fee sharing enabled to earn an
          ongoing share of that token's creator fees.
        </p>
      </div>
    );
  }

  const totalPending = seats.reduce((sum, s) => sum + Number(s.pending_lamports || 0), 0);
  const totalPaid = seats.reduce((sum, s) => sum + Number(s.paid_lamports || 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="border border-border bg-card p-4">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Pending (accrued)
          </p>
          <p className="mt-1 font-mono text-2xl font-bold text-foreground">
            {formatSol(totalPending)} SOL
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Below the per-payout floor — pays out once it clears next cycle.
          </p>
        </div>
        <div className="border border-border bg-card p-4">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Lifetime paid
          </p>
          <p className="mt-1 font-mono text-2xl font-bold text-primary">
            {formatSol(totalPaid)} SOL
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Your co-dev seats
        </p>
        {seats.map((seat) => (
          <div key={seat.launch_id} className="border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-foreground">{seat.token_name}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  ${seat.token_symbol}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-semibold text-foreground">
                  {formatSol(Number(seat.paid_lamports))} SOL paid
                </p>
                {Number(seat.pending_lamports) > 0 && (
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {formatSol(Number(seat.pending_lamports))} SOL pending
                  </p>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-border pt-2 font-mono text-[11px] text-muted-foreground">
              <span>
                Mode: {seat.codev_mode === "fcfs" ? "Capped" : "Open"}
              </span>
              <span>Joined {formatDate(seat.joined_at)}</span>
              <span>
                Roster: {seat.roster_locked_at ? "Locked" : "Open"}
              </span>
              <Link
                to={`/launch/${seat.launch_id}`}
                className="text-primary hover:underline"
              >
                View presale →
              </Link>
            </div>
          </div>
        ))}
      </div>

      {recentPayouts.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Recent payouts
          </p>
          <div className="border border-border bg-card">
            {recentPayouts.map((p, i) => (
              <div
                key={`${p.tx_signature}-${i}`}
                className={`flex items-center justify-between p-3 font-mono text-[11px] ${
                  i > 0 ? "border-t border-border" : ""
                }`}
              >
                <span className="text-muted-foreground">${p.token_symbol}</span>
                <span className="text-foreground">
                  {formatSol(Number(p.amount_lamports))} SOL
                </span>
                <span className="text-muted-foreground">{formatDate(p.created_at)}</span>
                <a
                  href={`https://solscan.io/tx/${p.tx_signature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  View <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CodevEarningsTab;
