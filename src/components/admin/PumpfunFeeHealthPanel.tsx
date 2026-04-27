import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExternalLink, Loader2, RefreshCw, AlertTriangle, Copy } from "lucide-react";
import { toast } from "sonner";
import { formatSolNumber, lamportsToSol, truncate } from "@/lib/adminFormat";

interface PumpfunLaunchRow {
  id: string;
  token_name: string;
  token_symbol: string;
  token_mint_address: string | null;
  pumpfun_fees_claimed_total: number | null;
  pumpfun_fees_last_claimed_at: string | null;
  pumpfun_last_claim_attempt_at: string | null;
  pumpfun_last_claim_error: string | null;
}

const CUSTODIAL_WALLET = "8fjQrCqeJfNgc5QQRarykX1eBwL7Xt5dvFi5hA2bqGed";
const RPC_URL =
  (import.meta.env.VITE_SOLANA_RPC_URL as string | undefined) ||
  "https://api.mainnet-beta.solana.com";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "in the future";
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const PumpfunFeeHealthPanel = () => {
  const queryClient = useQueryClient();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [custodialBalance, setCustodialBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["pumpfun-fee-health"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("launches")
        .select(
          "id, token_name, token_symbol, token_mint_address, pumpfun_fees_claimed_total, pumpfun_fees_last_claimed_at, pumpfun_last_claim_attempt_at, pumpfun_last_claim_error"
        )
        .eq("platform", "pumpfun")
        .eq("status", "launched")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PumpfunLaunchRow[];
    },
    refetchInterval: 30_000,
  });

  const fetchBalance = async () => {
    setBalanceLoading(true);
    try {
      const res = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getBalance",
          params: [CUSTODIAL_WALLET],
        }),
      });
      const json = await res.json();
      const lamports = json?.result?.value;
      if (typeof lamports === "number") setCustodialBalance(lamports);
    } catch (err) {
      // Non-fatal — just leave balance unset
      console.warn("Failed to fetch custodial balance", err);
    } finally {
      setBalanceLoading(false);
    }
  };

  useEffect(() => {
    fetchBalance();
  }, []);

  const forceRetry = async (launchId: string) => {
    setRetryingId(launchId);
    try {
      const { error } = await supabase.rpc("force_pumpfun_fee_claim_retry", {
        p_launch_id: launchId,
      });
      if (error) throw error;
      toast.success("Throttle cleared. Distributor will retry within ~30s.");
      await queryClient.invalidateQueries({ queryKey: ["pumpfun-fee-health"] });
    } catch (err: any) {
      toast.error(`Force retry failed: ${err?.message ?? err}`);
    } finally {
      setRetryingId(null);
    }
  };

  const balanceLow =
    custodialBalance !== null && custodialBalance < 5_000_000; // < 0.005 SOL

  const copyCustodialAddress = async () => {
    try {
      await navigator.clipboard.writeText(CUSTODIAL_WALLET);
      toast.success("Custodial wallet address copied");
    } catch {
      toast.error("Could not copy address");
    }
  };

  return (
    <div className="bg-card border border-border rounded-none p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Pump.fun Fee-Claim Health
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            Per-launch fee-claim status, errors, and force-retry. Auto-refreshes every 30s.
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs font-mono">
            <span className="text-muted-foreground uppercase tracking-widest">
              Custodial:
            </span>{" "}
            <span
              className={
                balanceLow ? "text-destructive font-bold" : "font-bold"
              }
            >
              {custodialBalance !== null
                ? `${formatSolNumber(lamportsToSol(custodialBalance))} SOL`
                : "—"}
            </span>
            <a
              href={`https://solscan.io/account/${CUSTODIAL_WALLET}`}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline ml-2 inline-flex items-center"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="rounded-none"
            onClick={fetchBalance}
            disabled={balanceLoading}
          >
            {balanceLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>

      {balanceLow && (
        <div className="bg-destructive/10 border border-destructive rounded-none p-3 mb-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
          <div className="text-xs flex-1">
            <div className="font-bold text-destructive mb-1">
              Custodial wallet underfunded — fee claims paused
            </div>
            <div className="text-muted-foreground">
              Balance is below 0.005 SOL. The distributor will not attempt
              creator-fee claims until the wallet is topped up. Recommended
              top-up: 0.05 SOL.
            </div>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className="font-mono text-foreground">
                {CUSTODIAL_WALLET}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="rounded-none h-6 px-2"
                onClick={copyCustodialAddress}
              >
                <Copy className="h-3 w-3 mr-1" /> Copy
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>Token</TableHead>
              <TableHead>Mint</TableHead>
              <TableHead className="text-right">Claimed Total</TableHead>
              <TableHead>Last Successful</TableHead>
              <TableHead>Last Attempt</TableHead>
              <TableHead>Last Error</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground py-6 font-mono text-xs"
                >
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground py-6 font-mono text-xs"
                >
                  No launched Pump.fun tokens
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => {
              const claimedSol = lamportsToSol(
                Number(row.pumpfun_fees_claimed_total ?? 0)
              );
              const hasError = !!row.pumpfun_last_claim_error;
              return (
                <TableRow key={row.id} className="border-border align-top">
                  <TableCell>
                    <div className="font-medium">{row.token_name}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {row.token_symbol}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.token_mint_address ? (
                      <div className="flex items-center gap-1">
                        {truncate(row.token_mint_address, 4, 4)}
                        <a
                          href={`https://solscan.io/token/${row.token_mint_address}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-right text-xs">
                    {formatSolNumber(claimedSol)} SOL
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {timeAgo(row.pumpfun_fees_last_claimed_at)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {timeAgo(row.pumpfun_last_claim_attempt_at)}
                  </TableCell>
                  <TableCell className="text-xs max-w-xs">
                    {hasError ? (
                      <span className="text-destructive break-words font-mono">
                        {row.pumpfun_last_claim_error}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-none"
                      disabled={retryingId === row.id}
                      onClick={() => forceRetry(row.id)}
                    >
                      {retryingId === row.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        "Force retry"
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default PumpfunFeeHealthPanel;