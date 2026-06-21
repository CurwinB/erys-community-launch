import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWallet } from "@/hooks/useWallet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

const LAMPORTS_PER_SOL = 1_000_000_000;
const fmtSol = (l: number | string | null | undefined) =>
  (Number(l ?? 0) / LAMPORTS_PER_SOL).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
const truncate = (s: string, n = 4) =>
  s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-n)}` : s;

type Row = {
  id: string;
  wallet_address: string;
  referral_code: string;
  status: string;
  created_at: string;
  referred_wallets: number;
  attributed_launches: number;
  paid_out_lamports: number;
};

const AffiliatesTab = () => {
  const { publicKey } = useWallet();
  const qc = useQueryClient();
  const [walletInput, setWalletInput] = useState("");
  const [creating, setCreating] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-affiliates", publicKey],
    enabled: !!publicKey,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc("admin_list_affiliates" as any, {
        p_admin_wallet: publicKey!,
      } as any);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-affiliates"] });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey || !walletInput.trim()) return;
    setCreating(true);
    try {
      const { error } = await supabase.rpc("admin_create_affiliate" as any, {
        p_admin_wallet: publicKey,
        p_wallet: walletInput.trim(),
      } as any);
      if (error) throw error;
      toast.success("Affiliate created");
      setWalletInput("");
      refresh();
    } catch (err: any) {
      toast.error("Failed to create affiliate", { description: err?.message });
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (row: Row) => {
    if (!publicKey) return;
    const next = row.status === "active" ? "revoked" : "active";
    try {
      const { error } = await supabase.rpc("admin_set_affiliate_status" as any, {
        p_admin_wallet: publicKey,
        p_affiliate_id: row.id,
        p_status: next,
      } as any);
      if (error) throw error;
      toast.success(`Affiliate ${next}`);
      refresh();
    } catch (err: any) {
      toast.error("Failed to update status", { description: err?.message });
    }
  };

  const copyLink = async (code: string) => {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://erys.live";
    await navigator.clipboard.writeText(`${origin}/r/${code}`);
    toast.success("Referral link copied");
  };

  return (
    <div className="space-y-4">
      <Card className="rounded-none border border-border bg-card p-4">
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
          Add affiliate
        </p>
        <form onSubmit={handleCreate} className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Wallet address"
            value={walletInput}
            onChange={(e) => setWalletInput(e.target.value)}
            className="font-mono text-xs rounded-none"
          />
          <Button
            type="submit"
            disabled={creating || !walletInput.trim()}
            className="rounded-none"
          >
            {creating && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Generate code
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          Generates a unique 8-char referral code and link for the wallet.
          Wallet must already have an Erys account (have connected at least once).
        </p>
      </Card>

      <Card className="rounded-none border border-border bg-card p-4">
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
          All affiliates
        </p>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No affiliates yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Wallet</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Referrals</TableHead>
                <TableHead className="text-right">Launches</TableHead>
                <TableHead className="text-right">Paid (SOL)</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">
                    {truncate(r.wallet_address, 6)}
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => copyLink(r.referral_code)}
                      className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                      title="Copy referral link"
                    >
                      {r.referral_code}
                      <Copy className="h-3 w-3" />
                    </button>
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        "font-mono text-xs uppercase " +
                        (r.status === "active"
                          ? "text-primary"
                          : "text-destructive")
                      }
                    >
                      {r.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {r.referred_wallets}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {r.attributed_launches}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtSol(r.paid_out_lamports)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-none"
                      onClick={() => handleToggle(r)}
                    >
                      {r.status === "active" ? "Revoke" : "Reactivate"}
                    </Button>
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

export default AffiliatesTab;