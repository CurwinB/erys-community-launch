import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { toast } from "@/hooks/use-toast";
import { lamportsToSol, formatDate } from "@/lib/adminFormat";
import { shortenAddress } from "@/lib/constants";

const FeeHarvestTab = () => {
  const { publicKey } = useWallet();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-fee-harvest", publicKey],
    enabled: !!publicKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_fee_harvest", {
        p_admin_wallet: publicKey!,
      });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
  });

  const forceMutation = useMutation({
    mutationFn: async (launchId: string) => {
      const { error } = await supabase.rpc("force_fee_harvest_retry", {
        p_launch_id: launchId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Harvest queued", description: "Will run on next tick." });
      qc.invalidateQueries({ queryKey: ["admin-fee-harvest"] });
    },
    onError: (e: any) =>
      toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  const rows = data || [];
  if (rows.length === 0) {
    return <div className="text-sm text-muted-foreground">No per-launch lightning wallets yet.</div>;
  }

  return (
    <div className="overflow-x-auto border border-border bg-card">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className="p-2 text-left">Launch</th>
            <th className="p-2 text-left">Wallet</th>
            <th className="p-2 text-left">State</th>
            <th className="p-2 text-right">Gross (SOL)</th>
            <th className="p-2 text-right">Treasury</th>
            <th className="p-2 text-right">Contrib.</th>
            <th className="p-2 text-right">Unclaimed</th>
            <th className="p-2 text-right">Cycles</th>
            <th className="p-2 text-left">Last attempt</th>
            <th className="p-2 text-left">Last error</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.launch_id} className="border-t border-border">
              <td className="p-2">
                {r.token_name} <span className="text-muted-foreground">${r.token_symbol}</span>
              </td>
              <td className="p-2 font-mono">{shortenAddress(r.lightning_wallet_public_key, 4)}</td>
              <td className="p-2 font-mono">{r.fee_harvest_state}</td>
              <td className="p-2 text-right font-mono">
                {lamportsToSol(Number(r.fee_harvest_total_lamports)).toFixed(4)}
              </td>
              <td className="p-2 text-right font-mono">
                {lamportsToSol(Number(r.fee_treasury_total_lamports)).toFixed(4)}
              </td>
              <td className="p-2 text-right font-mono">
                {lamportsToSol(Number(r.fee_contributor_total_lamports)).toFixed(4)}
              </td>
              <td className="p-2 text-right font-mono">
                {lamportsToSol(Number(r.unclaimed_lamports)).toFixed(4)}
              </td>
              <td className="p-2 text-right font-mono">{r.cycle_count}</td>
              <td className="p-2 text-muted-foreground">{formatDate(r.fee_harvest_last_attempt_at)}</td>
              <td className="p-2 text-destructive">{r.fee_harvest_last_error || "—"}</td>
              <td className="p-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => forceMutation.mutate(r.launch_id)}
                  disabled={forceMutation.isPending}
                >
                  Force
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default FeeHarvestTab;