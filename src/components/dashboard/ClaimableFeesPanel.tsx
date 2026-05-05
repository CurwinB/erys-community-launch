import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { toast } from "@/hooks/use-toast";
import { Loader2, Coins } from "lucide-react";
import { useState } from "react";

const lamportsToSol = (l: number) => l / 1_000_000_000;

const ClaimableFeesPanel = () => {
  const { publicKey } = useWallet();
  const qc = useQueryClient();
  const [claiming, setClaiming] = useState<string[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["claimable-fees", publicKey],
    enabled: !!publicKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_claimable_fees", {
        p_wallet: publicKey!,
      });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
  });

  const claimMutation = useMutation({
    mutationFn: async (allocationIds: string[]) => {
      const { data, error } = await supabase.functions.invoke("claim-fee-allocation", {
        body: { allocation_ids: allocationIds, wallet: publicKey },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      const okCount = (data?.results || []).filter((r: any) => r.ok).length;
      const failCount = (data?.results || []).filter((r: any) => !r.ok).length;
      toast({
        title: "Claim complete",
        description: `${okCount} succeeded${failCount ? `, ${failCount} failed` : ""}.`,
        variant: failCount > 0 ? "destructive" : "default",
      });
      qc.invalidateQueries({ queryKey: ["claimable-fees"] });
    },
    onError: (e: any) =>
      toast({ title: "Claim failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return null;
  const rows: any[] = data || [];
  const unclaimed = rows.filter((r) => r.claim_state === "unclaimed");
  if (unclaimed.length === 0) return null;

  // Group by launch
  const byLaunch = new Map<string, any[]>();
  for (const r of unclaimed) {
    if (!byLaunch.has(r.launch_id)) byLaunch.set(r.launch_id, []);
    byLaunch.get(r.launch_id)!.push(r);
  }

  const totalSol = unclaimed.reduce((s, r) => s + lamportsToSol(Number(r.lamports)), 0);

  const claimLaunch = async (allocIds: string[]) => {
    setClaiming(allocIds);
    try {
      await claimMutation.mutateAsync(allocIds);
    } finally {
      setClaiming([]);
    }
  };

  const claimAll = () => claimLaunch(unclaimed.map((r) => r.id));

  return (
    <div className="mb-6 border border-primary/40 bg-primary/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Coins className="h-5 w-5 text-primary" />
          <div>
            <p className="text-[10px] uppercase tracking-widest text-primary">
              Claimable Pump.fun fees
            </p>
            <p className="font-mono text-xl font-bold text-foreground">
              {totalSol.toFixed(4)} SOL
            </p>
          </div>
        </div>
        <Button size="sm" onClick={claimAll} disabled={claimMutation.isPending}>
          {claimMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Claim All
        </Button>
      </div>
      <div className="mt-3 space-y-2">
        {Array.from(byLaunch.entries()).map(([launchId, allocs]) => {
          const sum = allocs.reduce((s, a) => s + Number(a.lamports), 0);
          const ids = allocs.map((a) => a.id);
          const isClaiming = claiming.length > 0 && ids.every((id) => claiming.includes(id));
          const meta = allocs[0];
          return (
            <div
              key={launchId}
              className="flex items-center justify-between border-t border-primary/20 pt-2 text-xs"
            >
              <span className="text-foreground">
                {meta.token_name}{" "}
                <span className="text-muted-foreground">${meta.token_symbol}</span>
              </span>
              <div className="flex items-center gap-3">
                <span className="font-mono">{lamportsToSol(sum).toFixed(4)} SOL</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => claimLaunch(ids)}
                  disabled={claimMutation.isPending}
                >
                  {isClaiming ? <Loader2 className="h-3 w-3 animate-spin" /> : "Claim"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ClaimableFeesPanel;