import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatSol, shortenAddress } from "@/lib/constants";
import { Users, Lock, Unlock } from "lucide-react";

interface CodevPanelProps {
  launchId: string;
}

interface CodevSeat {
  wallet_address: string;
  contribution_lamports: number;
  pending_lamports: number;
  paid_lamports: number;
}

interface CodevInfo {
  enabled: boolean;
  mode: "proportional" | "fcfs";
  roster_locked_at: string | null;
  seat_count: number;
  seat_cap: number;
  top_seats: CodevSeat[];
}

const modeLabel = (mode: string) =>
  mode === "fcfs" ? "Top 100 by size" : "Open";

const CodevPanel = ({ launchId }: CodevPanelProps) => {
  const { data: info, isLoading } = useQuery({
    queryKey: ["codev-info", launchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_launch_codev_info", {
        p_launch_id: launchId,
      });
      if (error) throw error;
      return data as unknown as CodevInfo;
    },
    enabled: !!launchId,
    refetchInterval: 30000,
  });

  if (isLoading || !info || !info.enabled) return null;

  const locked = !!info.roster_locked_at;
  const totalContribution = info.top_seats.reduce(
    (sum, s) => sum + Number(s.contribution_lamports || 0),
    0
  );

  return (
    <div className="border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Co-dev fee sharing
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
          {locked ? (
            <>
              <Lock className="h-3 w-3" />
              Roster locked
            </>
          ) : (
            <>
              <Unlock className="h-3 w-3" />
              Roster open
            </>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <p className="font-mono text-lg font-bold text-foreground">
            {info.seat_count}
            <span className="text-xs font-normal text-muted-foreground">
              /{info.seat_cap}
            </span>
          </p>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Seats</p>
        </div>
        <div>
          <p className="font-mono text-lg font-bold text-foreground">
            {modeLabel(info.mode)}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Mode</p>
        </div>
        <div>
          <p className="font-mono text-lg font-bold text-primary">20%</p>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Of creator fees
          </p>
        </div>
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
        Contributors who become co-devs share 20% of this token's ongoing
        creator fees, split proportionally to how much SOL they put in.
        {info.mode === "fcfs"
          ? " Only the 100 largest contributors earn a seat — decided once, at launch."
          : " Any contributor can earn a seat, up to 100 total."}
      </p>

      {info.top_seats.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Top co-devs
          </p>
          {info.top_seats.slice(0, 5).map((seat) => {
            const pct =
              totalContribution > 0
                ? (Number(seat.contribution_lamports) / totalContribution) * 100
                : 0;
            return (
              <div
                key={seat.wallet_address}
                className="flex items-center justify-between border-t border-border pt-1.5 font-mono text-[11px]"
              >
                <span className="text-muted-foreground">
                  {shortenAddress(seat.wallet_address, 4)}
                </span>
                <div className="flex items-center gap-3 text-right">
                  <span className="text-muted-foreground">{pct.toFixed(1)}%</span>
                  <span className="text-foreground">
                    {formatSol(Number(seat.paid_lamports))} SOL paid
                  </span>
                </div>
              </div>
            );
          })}
          {info.seat_count > 5 && (
            <p className="pt-1 text-[10px] text-muted-foreground">
              +{info.seat_count - 5} more co-dev{info.seat_count - 5 === 1 ? "" : "s"}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default CodevPanel;
