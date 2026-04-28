import { useMemo, useState, Fragment } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  RotateCw,
  Undo2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useWallet } from "@/hooks/useWallet";
import {
  formatSol,
  formatSolNumber,
  truncate,
  formatDate,
  ataReserveLamports,
  GAS_RESERVE_LAMPORTS,
  lamportsToSol,
  formatPercent,
  formatInt,
} from "@/lib/adminFormat";
import { exportToCsv } from "@/utils/exportCsv";
import PlatformBadge from "./PlatformBadge";

interface Contribution {
  id: string;
  launch_id: string;
  wallet_address: string;
  amount_lamports: number;
  basis_points: number | null;
  token_amount: number | null;
  tokens_distributed: boolean | null;
  distribution_tx_signature: string | null;
  refund_tx_signature: string | null;
}

interface Launch {
  id: string;
  token_name: string;
  token_symbol: string;
  platform: string;
  status: string;
  launch_datetime: string;
  distribution_completed: boolean | null;
  pumpfun_fees_claimed_total: number | null;
}

interface Props {
  launches: Launch[];
  contributions: Contribution[];
}

const LaunchesTab = ({ launches, contributions }: Props) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [refunding, setRefunding] = useState<Set<string>>(new Set());
  const [refundProgress, setRefundProgress] = useState<{
    launchId: string;
    current: number;
    total: number;
  } | null>(null);
  const [confirmRefund, setConfirmRefund] = useState<{
    launchId: string;
    pending: Contribution[];
    tokenSymbol: string;
  } | null>(null);
  const { publicKey: walletAddress } = useWallet();
  const queryClient = useQueryClient();

  const runBulkRefund = async (launchId: string, pending: Contribution[]) => {
    setRefunding((prev) => new Set(prev).add(launchId));
    let success = 0;
    let failed = 0;
    try {
      for (let i = 0; i < pending.length; i++) {
        setRefundProgress({
          launchId,
          current: i + 1,
          total: pending.length,
        });
        try {
          const { data, error } = await supabase.functions.invoke(
            "refund-contributor",
            {
              body: {
                contribution_id: pending[i].id,
                launch_id: launchId,
              },
            },
          );
          if (error) throw new Error(error.message);
          if ((data as any)?.error) throw new Error((data as any).error);
          success++;
        } catch (err: any) {
          failed++;
          console.error("refund failed:", err?.message ?? err);
        }
        if (i < pending.length - 1) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      toast({
        title: "Refunds complete",
        description: `${success} succeeded, ${failed} failed`,
        variant: failed > 0 ? "destructive" : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
    } finally {
      setRefundProgress(null);
      setRefunding((prev) => {
        const next = new Set(prev);
        next.delete(launchId);
        return next;
      });
    }
  };

  const handleRetry = async (launchId: string) => {
    if (!walletAddress) {
      toast({
        title: "Connect wallet first",
        variant: "destructive",
      });
      return;
    }
    setRetrying((prev) => new Set(prev).add(launchId));
    try {
      const { data, error } = await supabase.functions.invoke(
        "retry-failed-launch",
        { body: { launch_id: launchId, admin_wallet: walletAddress } },
      );
      if (error || (data as any)?.error) {
        toast({
          title: "Retry failed",
          description: (data as any)?.error ?? error?.message ?? "Unknown",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Retry queued",
          description: "Executor will pick it up on the next tick.",
        });
      }
    } catch (err: any) {
      toast({
        title: "Retry failed",
        description: err?.message ?? "Unknown",
        variant: "destructive",
      });
    } finally {
      setRetrying((prev) => {
        const next = new Set(prev);
        next.delete(launchId);
        return next;
      });
    }
  };

  const rows = useMemo(() => {
    return launches.map((l) => {
      const launchContribs = contributions.filter(
        (c) => c.launch_id === l.id && !c.refund_tx_signature,
      );
      const contributorCount = launchContribs.length;
      const solInLamports = launchContribs.reduce(
        (sum, c) => sum + Number(c.amount_lamports),
        0,
      );
      const ataReserve = ataReserveLamports(contributorCount);
      const initialBuy = Math.max(
        0,
        solInLamports - ataReserve - GAS_RESERVE_LAMPORTS,
      );
      const distributedLamports = launchContribs
        .filter((c) => c.tokens_distributed)
        .reduce((sum, c) => sum + Number(c.amount_lamports), 0);

      const isPump = l.platform === "pumpfun";
      const totalPumpFees = Number(l.pumpfun_fees_claimed_total ?? 0);
      const platformFeeSol = isPump ? lamportsToSol(totalPumpFees * 0.5) : null;
      const creatorFeeSol = isPump ? lamportsToSol(totalPumpFees * 0.5) : null;

      return {
        launch: l,
        contribs: launchContribs,
        contributorCount,
        solInLamports,
        ataReserve,
        initialBuy,
        distributedLamports,
        platformFeeSol,
        creatorFeeSol,
      };
    });
  }, [launches, contributions]);

  const handleExport = () => {
    const csvRows = rows.map(
      ({
        launch,
        contributorCount,
        solInLamports,
        ataReserve,
        initialBuy,
        distributedLamports,
        platformFeeSol,
        creatorFeeSol,
      }) => ({
        launch_id: launch.id,
        token_name: launch.token_name,
        token_symbol: launch.token_symbol,
        platform: launch.platform,
        status: launch.status,
        launch_date: launch.launch_datetime,
        contributors: contributorCount,
        sol_in: lamportsToSol(solInLamports).toFixed(4),
        initial_buy: lamportsToSol(initialBuy).toFixed(4),
        ata_reserve: lamportsToSol(ataReserve).toFixed(4),
        gas_reserve: lamportsToSol(GAS_RESERVE_LAMPORTS).toFixed(4),
        sol_distributed: lamportsToSol(distributedLamports).toFixed(4),
        platform_fee_sol:
          platformFeeSol == null ? "" : platformFeeSol.toFixed(4),
        creator_fee_sol:
          creatorFeeSol == null ? "" : creatorFeeSol.toFixed(4),
        distribution_complete: launch.distribution_completed ? "yes" : "no",
      }),
    );
    exportToCsv("erys-launches", csvRows);
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={handleExport}
          className="rounded-none"
        >
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>
      <div className="bg-card border border-border rounded-none overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-8" />
              <TableHead>Launch ID</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Launch Date</TableHead>
              <TableHead className="text-right">Contributors</TableHead>
              <TableHead className="text-right">SOL In</TableHead>
              <TableHead className="text-right">Initial Buy</TableHead>
              <TableHead className="text-right">ATA Reserve</TableHead>
              <TableHead className="text-right">Gas Reserve</TableHead>
              <TableHead className="text-right">SOL Distributed</TableHead>
              <TableHead className="text-right">Platform Fee</TableHead>
              <TableHead className="text-right">Creator Fee</TableHead>
              <TableHead>Dist. Complete</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={15}
                  className="text-center text-muted-foreground py-8 font-mono text-sm"
                >
                  No launches yet
                </TableCell>
              </TableRow>
            )}
            {rows.map(
              ({
                launch,
                contribs,
                contributorCount,
                solInLamports,
                ataReserve,
                initialBuy,
                distributedLamports,
                platformFeeSol,
                creatorFeeSol,
              }) => {
                const isOpen = expanded.has(launch.id);
                const isBags = launch.platform !== "pumpfun";
                return (
                  <Fragment key={launch.id}>
                    <TableRow className="border-border">
                      <TableCell>
                        <button
                          onClick={() => toggleExpand(launch.id)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {truncate(launch.id, 6, 4)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{launch.token_symbol}</span>
                          <span className="text-xs text-muted-foreground">
                            {launch.token_name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <PlatformBadge platform={launch.platform} />
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs uppercase tracking-wider">
                          {launch.status}
                        </span>
                        {launch.status === "execution_failed" && (
                          <span className="inline-flex gap-1 ml-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-none h-6 px-2 text-[10px]"
                              disabled={retrying.has(launch.id)}
                              onClick={() => handleRetry(launch.id)}
                            >
                              <RotateCw className="h-3 w-3 mr-1" />
                              {retrying.has(launch.id) ? "Retrying…" : "Retry"}
                            </Button>
                            {(() => {
                              const pending = contribs.filter(
                                (c) => !c.refund_tx_signature,
                              );
                              if (pending.length === 0) return null;
                              const isRefunding = refunding.has(launch.id);
                              const prog =
                                refundProgress?.launchId === launch.id
                                  ? refundProgress
                                  : null;
                              return (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="rounded-none h-6 px-2 text-[10px] border-destructive/60 text-destructive hover:bg-destructive/10"
                                  disabled={isRefunding}
                                  onClick={() =>
                                    setConfirmRefund({
                                      launchId: launch.id,
                                      pending,
                                      tokenSymbol: launch.token_symbol,
                                    })
                                  }
                                >
                                  {isRefunding ? (
                                    <>
                                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                      {prog
                                        ? `${prog.current}/${prog.total}`
                                        : "Refunding…"}
                                    </>
                                  ) : (
                                    <>
                                      <Undo2 className="h-3 w-3 mr-1" />
                                      Refund ({pending.length})
                                    </>
                                  )}
                                </Button>
                              );
                            })()}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatDate(launch.launch_datetime)}
                      </TableCell>
                      <TableCell className="font-mono text-right">
                        {formatInt(contributorCount)}
                      </TableCell>
                      <TableCell className="font-mono text-right">
                        {formatSol(solInLamports)}
                      </TableCell>
                      <TableCell className="font-mono text-right">
                        {formatSol(initialBuy)}
                      </TableCell>
                      <TableCell className="font-mono text-right text-muted-foreground">
                        {formatSol(ataReserve)}
                      </TableCell>
                      <TableCell className="font-mono text-right text-muted-foreground">
                        {formatSol(GAS_RESERVE_LAMPORTS)}
                      </TableCell>
                      <TableCell className="font-mono text-right">
                        {formatSol(distributedLamports)}
                      </TableCell>
                      <TableCell className="font-mono text-right">
                        {isBags ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-muted-foreground cursor-help">
                                —
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              Platform fees pooled (not per-launch)
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          formatSolNumber(platformFeeSol ?? 0)
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-right">
                        {isBags ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          formatSolNumber(creatorFeeSol ?? 0)
                        )}
                      </TableCell>
                      <TableCell>
                        {launch.distribution_completed ? (
                          <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border border-success text-success rounded-none">
                            Yes
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border border-muted-foreground/40 text-muted-foreground rounded-none">
                            Pending
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="border-border bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={15} className="p-0">
                          <div className="p-4">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                              Contributions ({contribs.length})
                            </div>
                            <Table>
                              <TableHeader>
                                <TableRow className="border-border hover:bg-transparent">
                                  <TableHead>Wallet</TableHead>
                                  <TableHead className="text-right">SOL In</TableHead>
                                  <TableHead className="text-right">Share</TableHead>
                                  <TableHead className="text-right">Tokens</TableHead>
                                  <TableHead>Distributed</TableHead>
                                  <TableHead>Distribution TX</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {contribs.map((c) => (
                                  <TableRow key={c.id} className="border-border">
                                    <TableCell className="font-mono text-xs">
                                      {truncate(c.wallet_address)}
                                    </TableCell>
                                    <TableCell className="font-mono text-right">
                                      {formatSol(c.amount_lamports)}
                                    </TableCell>
                                    <TableCell className="font-mono text-right">
                                      {formatPercent(c.basis_points)}
                                    </TableCell>
                                    <TableCell className="font-mono text-right">
                                      {c.token_amount
                                        ? formatInt(c.token_amount)
                                        : "—"}
                                    </TableCell>
                                    <TableCell>
                                      {c.tokens_distributed ? (
                                        <span className="text-success font-mono text-xs">
                                          ✓
                                        </span>
                                      ) : (
                                        <span className="text-muted-foreground font-mono text-xs">
                                          —
                                        </span>
                                      )}
                                    </TableCell>
                                    <TableCell className="font-mono text-xs">
                                      {c.distribution_tx_signature ? (
                                        <a
                                          href={`https://solscan.io/tx/${c.distribution_tx_signature}`}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-primary hover:underline"
                                        >
                                          {truncate(c.distribution_tx_signature)}
                                        </a>
                                      ) : (
                                        "—"
                                      )}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              },
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={confirmRefund !== null}
        onOpenChange={(open) => !open && setConfirmRefund(null)}
      >
        <AlertDialogContent className="rounded-none">
          <AlertDialogHeader>
            <AlertDialogTitle>Refund all pending contributors</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Refund{" "}
                  <span className="font-mono">
                    {confirmRefund?.pending.length ?? 0}
                  </span>{" "}
                  contributor
                  {(confirmRefund?.pending.length ?? 0) === 1 ? "" : "s"} of{" "}
                  <span className="font-mono">
                    {confirmRefund?.tokenSymbol}
                  </span>
                  ?
                </p>
                <p className="text-muted-foreground">
                  Each refund is an on-chain SOL transfer from the escrow
                  wallet. Runs sequentially with a 1s gap between attempts.
                  This action is irreversible.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-none">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-none bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmRefund) {
                  void runBulkRefund(
                    confirmRefund.launchId,
                    confirmRefund.pending,
                  );
                }
                setConfirmRefund(null);
              }}
            >
              Confirm Refund
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default LaunchesTab;