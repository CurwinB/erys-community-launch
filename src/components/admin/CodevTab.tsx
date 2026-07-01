import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWallet } from "@/hooks/useWallet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { lamportsToSol, formatDate } from "@/lib/adminFormat";
import { shortenAddress } from "@/lib/constants";

interface AdminLaunchLite {
  id: string;
  token_name: string;
  token_symbol: string;
  codev_sharing_enabled?: boolean | null;
}

interface CodevRow {
  wallet_address: string;
  contribution_lamports: number;
  pending_lamports: number;
  paid_lamports: number;
  joined_at: string;
}

// launches list comes from the same admin_list_launches RPC AdminPage
// already calls — accept it as a prop so this tab doesn't duplicate the
// fetch, just filter to launches with co-dev sharing enabled.
const CodevTab = ({ launches }: { launches: AdminLaunchLite[] }) => {
  const { publicKey } = useWallet();
  const qc = useQueryClient();
  const [selectedLaunchId, setSelectedLaunchId] = useState<string>("");

  const codevLaunches = launches.filter((l) => l.codev_sharing_enabled);
  const activeLaunchId = selectedLaunchId || codevLaunches[0]?.id || "";
  const activeLaunch = codevLaunches.find((l) => l.id === activeLaunchId);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-codev-roster", activeLaunchId, publicKey],
    enabled: !!publicKey && !!activeLaunchId,
    queryFn: async (): Promise<CodevRow[]> => {
      const { data, error } = await supabase.rpc("admin_list_launch_codevs", {
        p_admin_wallet: publicKey!,
        p_launch_id: activeLaunchId,
      });
      if (error) throw error;
      return (data ?? []) as CodevRow[];
    },
  });

  const forceMutation = useMutation({
    mutationFn: async (launchId: string) => {
      const { error } = await supabase.rpc("force_fee_harvest_retry", {
        p_launch_id: launchId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Harvest queued",
        description: "Co-dev payouts (and creator/treasury) will run on next tick.",
      });
      qc.invalidateQueries({ queryKey: ["admin-codev-roster"] });
    },
    onError: (e: any) =>
      toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  if (codevLaunches.length === 0) {
    return (
      <Card className="rounded-none border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          No launches have co-dev sharing enabled yet.
        </p>
      </Card>
    );
  }

  const totalPending = rows.reduce((sum, r) => sum + Number(r.pending_lamports || 0), 0);
  const totalPaid = rows.reduce((sum, r) => sum + Number(r.paid_lamports || 0), 0);

  return (
    <div className="space-y-4">
      <Card className="rounded-none border border-border bg-card p-4">
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
          Select launch
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Select value={activeLaunchId} onValueChange={setSelectedLaunchId}>
            <SelectTrigger className="w-full rounded-none sm:w-80">
              <SelectValue placeholder="Select a launch" />
            </SelectTrigger>
            <SelectContent>
              {codevLaunches.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.token_name} (${l.token_symbol})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            className="rounded-none"
            disabled={!activeLaunchId || forceMutation.isPending}
            onClick={() => activeLaunch && forceMutation.mutate(activeLaunch.id)}
          >
            {forceMutation.isPending && (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            )}
            Force harvest retry
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card className="rounded-none border border-border bg-card p-4">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Total pending (accrued, unpaid)
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-foreground">
            {lamportsToSol(totalPending).toFixed(4)} SOL
          </p>
        </Card>
        <Card className="rounded-none border border-border bg-card p-4">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Total paid (lifetime)
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-primary">
            {lamportsToSol(totalPaid).toFixed(4)} SOL
          </p>
        </Card>
      </div>

      <Card className="rounded-none border border-border bg-card p-4">
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
          Co-dev roster ({rows.length})
        </p>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No co-devs have joined this launch's roster yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Wallet</TableHead>
                <TableHead className="text-right">Contribution (SOL)</TableHead>
                <TableHead className="text-right">Pending (SOL)</TableHead>
                <TableHead className="text-right">Paid (SOL)</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.wallet_address}>
                  <TableCell className="font-mono text-xs">
                    {shortenAddress(r.wallet_address, 6)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {lamportsToSol(Number(r.contribution_lamports)).toFixed(4)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {lamportsToSol(Number(r.pending_lamports)).toFixed(4)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {lamportsToSol(Number(r.paid_lamports)).toFixed(4)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(r.joined_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
};

export default CodevTab;
