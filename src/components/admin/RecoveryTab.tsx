import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  formatDate,
  formatSolNumber,
  lamportsToSol,
  truncate,
} from "@/lib/adminFormat";
import StatusBadge from "@/components/StatusBadge";
import PlatformBadge from "@/components/admin/PlatformBadge";
import PumpfunFeeHealthPanel from "@/components/admin/PumpfunFeeHealthPanel";

interface Contribution {
  id: string;
  launch_id: string;
  wallet_address: string;
  amount_lamports: number;
  refund_tx_signature: string | null;
  contributed_at: string;
}

interface Launch {
  id: string;
  token_name: string;
  token_symbol: string;
  platform: string;
  status: string;
  launch_datetime: string;
  escrow_wallet_public_key: string;
  distribution_completed: boolean | null;
}

interface Props {
  launches: Launch[];
  contributions: Contribution[];
}

const ACTIVE_RECOVERY_STATUSES = new Set([
  "scheduled",
  "executing",
  "execution_failed",
]);

const copyToClipboard = (text: string, label: string) => {
  navigator.clipboard.writeText(text);
  toast.success(`${label} copied`);
};

const RecoveryTab = ({ launches, contributions }: Props) => {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmRefund, setConfirmRefund] = useState<{
    contribution: Contribution;
    launch: Launch;
  } | null>(null);
  const [confirmBulk, setConfirmBulk] = useState<{
    launch: Launch;
    pending: Contribution[];
  } | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{
    launchId: string;
    current: number;
    total: number;
  } | null>(null);

  const contribsByLaunch = useMemo(() => {
    const m = new Map<string, Contribution[]>();
    contributions.forEach((c) => {
      const arr = m.get(c.launch_id) ?? [];
      arr.push(c);
      m.set(c.launch_id, arr);
    });
    return m;
  }, [contributions]);

  const recoveryLaunches = useMemo(() => {
    return launches.filter((l) => {
      if (ACTIVE_RECOVERY_STATUSES.has(l.status)) return true;
      const launchContribs = contribsByLaunch.get(l.id) ?? [];
      if (l.status === "launched" && l.distribution_completed === false) {
        return true;
      }
      if (l.status === "cancelled" && launchContribs.length > 0) {
        return true;
      }
      return false;
    });
  }, [launches, contribsByLaunch]);

  const escrowDbBalance = (launchId: string) => {
    const arr = contribsByLaunch.get(launchId) ?? [];
    const sumLamports = arr
      .filter((c) => !c.refund_tx_signature)
      .reduce((sum, c) => sum + Number(c.amount_lamports), 0);
    return lamportsToSol(sumLamports);
  };

  const refundOne = async (contribution: Contribution, launch: Launch) => {
    setRefundingId(contribution.id);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[contribution.id];
      return next;
    });
    try {
      const { data, error } = await supabase.functions.invoke(
        "refund-contributor",
        {
          body: {
            contribution_id: contribution.id,
            launch_id: launch.id,
          },
        },
      );
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      const refundedSol = lamportsToSol(
        Number(data?.refundedLamports ?? contribution.amount_lamports),
      ).toFixed(4);
      const shortfallSol = lamportsToSol(
        Number(data?.shortfallLamports ?? 0),
      ).toFixed(4);
      if (data?.partial) {
        toast.warning(
          `Refunded ${refundedSol} SOL — ${shortfallSol} SOL unrecoverable due to escrow shortfall`,
        );
      } else {
        toast.success(`Refunded ${refundedSol} SOL`);
      }
      await queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
      return { ok: true as const, signature: data?.txSignature };
    } catch (err: any) {
      const message = err?.message ?? "Refund failed";
      setErrors((prev) => ({ ...prev, [contribution.id]: message }));
      toast.error(`Refund failed: ${message}`);
      return { ok: false as const, error: message };
    } finally {
      setRefundingId(null);
    }
  };

  const runBulk = async (launch: Launch, pending: Contribution[]) => {
    let success = 0;
    let failed = 0;
    for (let i = 0; i < pending.length; i++) {
      setBulkProgress({
        launchId: launch.id,
        current: i + 1,
        total: pending.length,
      });
      const result = await refundOne(pending[i], launch);
      if (result.ok) success++;
      else failed++;
      if (i < pending.length - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    setBulkProgress(null);
    toast.success(
      `Bulk refund complete: ${success} succeeded, ${failed} failed`,
    );
  };

  return (
    <div className="space-y-3">
      {/* Warning banner */}
      <div className="bg-destructive/10 border border-destructive rounded-none p-4 flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-mono text-sm uppercase tracking-widest text-destructive font-bold">
            Warning
          </div>
          <div className="text-sm text-foreground mt-1">
            This section moves real SOL. Every action here is irreversible.
          </div>
        </div>
      </div>

      <PumpfunFeeHealthPanel />

      <div className="bg-card border border-border rounded-none overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-8" />
              <TableHead>Launch</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Launch Time</TableHead>
              <TableHead className="text-right">Contributors</TableHead>
              <TableHead className="text-right">SOL in Escrow (DB)</TableHead>
              <TableHead>Escrow Wallet</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recoveryLaunches.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center text-muted-foreground py-8 font-mono text-sm"
                >
                  No launches need recovery
                </TableCell>
              </TableRow>
            )}
            {recoveryLaunches.map((launch) => {
              const launchContribs = contribsByLaunch.get(launch.id) ?? [];
              const pending = launchContribs.filter(
                (c) => !c.refund_tx_signature,
              );
              const dbBalance = escrowDbBalance(launch.id);
              const isOpen = expandedId === launch.id;

              return (
                <Collapsible
                  key={launch.id}
                  open={isOpen}
                  onOpenChange={(open) =>
                    setExpandedId(open ? launch.id : null)
                  }
                  asChild
                >
                  <>
                    <TableRow className="border-border">
                      <TableCell>
                        <CollapsibleTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-none"
                          >
                            {isOpen ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </CollapsibleTrigger>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          {truncate(launch.id, 6, 4)}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 rounded-none"
                            onClick={() =>
                              copyToClipboard(launch.id, "Launch ID")
                            }
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{launch.token_name}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {launch.token_symbol}
                        </div>
                      </TableCell>
                      <TableCell>
                        <PlatformBadge platform={launch.platform} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={launch.status as any} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatDate(launch.launch_datetime)}
                      </TableCell>
                      <TableCell className="font-mono text-right">
                        {launchContribs.length}
                      </TableCell>
                      <TableCell className="font-mono text-right">
                        {formatSolNumber(dbBalance)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <div className="flex items-center gap-1">
                          {truncate(launch.escrow_wallet_public_key, 4, 4)}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 rounded-none"
                            onClick={() =>
                              copyToClipboard(
                                launch.escrow_wallet_public_key,
                                "Escrow address",
                              )
                            }
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                          <a
                            href={`https://solscan.io/account/${launch.escrow_wallet_public_key}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </TableCell>
                    </TableRow>
                    <CollapsibleContent asChild>
                      <TableRow className="border-border bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={9} className="p-4">
                          {/* Section 1: Escrow info */}
                          <div className="bg-background border border-border rounded-none p-3 mb-4">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                              Escrow Wallet
                            </div>
                            <div className="font-mono text-xs break-all flex items-center gap-2">
                              <span>{launch.escrow_wallet_public_key}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 rounded-none flex-shrink-0"
                                onClick={() =>
                                  copyToClipboard(
                                    launch.escrow_wallet_public_key,
                                    "Escrow address",
                                  )
                                }
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                              <a
                                href={`https://solscan.io/account/${launch.escrow_wallet_public_key}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary hover:underline flex-shrink-0"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                            <div className="mt-2 text-sm">
                              <span className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
                                DB Estimated Balance:
                              </span>{" "}
                              <span className="font-mono font-bold">
                                {formatSolNumber(dbBalance)} SOL
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Note: Balance is estimated from database. Check
                              Solscan for live balance.
                            </div>
                          </div>

                          {/* Section 2: Contributors */}
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                              Contributors ({launchContribs.length})
                            </div>
                            {pending.length > 0 && (
                              <div className="flex items-center gap-2">
                                {bulkProgress?.launchId === launch.id && (
                                  <span className="text-xs font-mono text-muted-foreground">
                                    Refunding {bulkProgress.current} of{" "}
                                    {bulkProgress.total}…
                                  </span>
                                )}
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="rounded-none"
                                  disabled={
                                    bulkProgress !== null ||
                                    refundingId !== null
                                  }
                                  onClick={() =>
                                    setConfirmBulk({ launch, pending })
                                  }
                                >
                                  Refund All Pending Contributors
                                </Button>
                              </div>
                            )}
                          </div>

                          <div className="bg-background border border-border rounded-none overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow className="border-border hover:bg-transparent">
                                  <TableHead>Wallet</TableHead>
                                  <TableHead className="text-right">
                                    SOL Contributed
                                  </TableHead>
                                  <TableHead>Refund Status</TableHead>
                                  <TableHead>Refund TX</TableHead>
                                  <TableHead className="text-right">
                                    Action
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {launchContribs.length === 0 && (
                                  <TableRow>
                                    <TableCell
                                      colSpan={5}
                                      className="text-center text-muted-foreground py-4 font-mono text-xs"
                                    >
                                      No contributions
                                    </TableCell>
                                  </TableRow>
                                )}
                                {launchContribs.map((c) => {
                                  const isRefunded = !!c.refund_tx_signature;
                                  const isThisRefunding =
                                    refundingId === c.id;
                                  const error = errors[c.id];
                                  return (
                                    <>
                                      <TableRow
                                        key={c.id}
                                        className="border-border"
                                      >
                                        <TableCell className="font-mono text-xs">
                                          <div className="flex items-center gap-1">
                                            {truncate(c.wallet_address)}
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-5 w-5 rounded-none"
                                              onClick={() =>
                                                copyToClipboard(
                                                  c.wallet_address,
                                                  "Wallet",
                                                )
                                              }
                                            >
                                              <Copy className="h-3 w-3" />
                                            </Button>
                                            <a
                                              href={`https://solscan.io/account/${c.wallet_address}`}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="text-primary hover:underline"
                                            >
                                              <ExternalLink className="h-3 w-3" />
                                            </a>
                                          </div>
                                        </TableCell>
                                        <TableCell className="font-mono text-right">
                                          {lamportsToSol(
                                            c.amount_lamports,
                                          ).toFixed(4)}
                                        </TableCell>
                                        <TableCell>
                                          {isRefunded ? (
                                            <span className="inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border border-success text-success rounded-none">
                                              Refunded
                                            </span>
                                          ) : (
                                            <span className="inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border border-yellow-500/50 text-yellow-400 rounded-none">
                                              Pending
                                            </span>
                                          )}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                          {c.refund_tx_signature ? (
                                            <a
                                              href={`https://solscan.io/tx/${c.refund_tx_signature}`}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="text-primary hover:underline"
                                            >
                                              {truncate(
                                                c.refund_tx_signature,
                                              )}
                                            </a>
                                          ) : (
                                            "—"
                                          )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                          <Button
                                            size="sm"
                                            variant="destructive"
                                            className="rounded-none"
                                            disabled={
                                              isRefunded ||
                                              isThisRefunding ||
                                              bulkProgress !== null
                                            }
                                            onClick={() =>
                                              setConfirmRefund({
                                                contribution: c,
                                                launch,
                                              })
                                            }
                                          >
                                            {isThisRefunding && (
                                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                            )}
                                            Refund
                                          </Button>
                                        </TableCell>
                                      </TableRow>
                                      {error && (
                                        <TableRow
                                          key={`${c.id}-err`}
                                          className="border-border"
                                        >
                                          <TableCell
                                            colSpan={5}
                                            className="text-destructive font-mono text-xs py-2"
                                          >
                                            Error: {error}
                                          </TableCell>
                                        </TableRow>
                                      )}
                                    </>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        </TableCell>
                      </TableRow>
                    </CollapsibleContent>
                  </>
                </Collapsible>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Single refund confirmation */}
      <AlertDialog
        open={confirmRefund !== null}
        onOpenChange={(open) => !open && setConfirmRefund(null)}
      >
        <AlertDialogContent className="rounded-none">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm refund</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div>
                  Refund{" "}
                  <span className="font-mono font-bold text-foreground">
                    {confirmRefund &&
                      lamportsToSol(
                        confirmRefund.contribution.amount_lamports,
                      ).toFixed(4)}{" "}
                    SOL
                  </span>{" "}
                  to{" "}
                  <span className="font-mono text-foreground">
                    {confirmRefund &&
                      truncate(confirmRefund.contribution.wallet_address)}
                  </span>
                  ?
                </div>
                <div>
                  This will transfer SOL from the escrow wallet back to the
                  contributor.
                </div>
                <div>
                  A small network fee (~0.000005 SOL) will be deducted.
                </div>
                <div className="text-destructive">
                  This action cannot be undone.
                </div>
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
                  void refundOne(
                    confirmRefund.contribution,
                    confirmRefund.launch,
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

      {/* Bulk refund confirmation */}
      <AlertDialog
        open={confirmBulk !== null}
        onOpenChange={(open) => !open && setConfirmBulk(null)}
      >
        <AlertDialogContent className="rounded-none">
          <AlertDialogHeader>
            <AlertDialogTitle>Refund all pending contributors</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div>
                  Refund{" "}
                  <span className="font-mono font-bold text-foreground">
                    {confirmBulk?.pending.length ?? 0}
                  </span>{" "}
                  contributors totaling{" "}
                  <span className="font-mono font-bold text-foreground">
                    {confirmBulk
                      ? formatSolNumber(
                          lamportsToSol(
                            confirmBulk.pending.reduce(
                              (s, c) => s + Number(c.amount_lamports),
                              0,
                            ),
                          ),
                        )
                      : "0.0000"}{" "}
                    SOL
                  </span>
                  ?
                </div>
                <div>
                  Refunds run sequentially with a 1-second gap. Network fees
                  (~0.000005 SOL each) will be deducted.
                </div>
                <div className="text-destructive">
                  This action cannot be undone.
                </div>
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
                if (confirmBulk) {
                  void runBulk(confirmBulk.launch, confirmBulk.pending);
                }
                setConfirmBulk(null);
              }}
            >
              Confirm Bulk Refund
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default RecoveryTab;