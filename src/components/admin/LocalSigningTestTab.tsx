import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { AlertTriangle, Loader2, Copy, ExternalLink, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Launch {
  id: string;
  token_name: string;
  token_symbol: string;
  status: string;
  platform: string;
  pumpfun_mint_keypair_encrypted?: string | null;
  token_mint_address?: string | null;
}

interface RunResult {
  ok: boolean;
  dryRun?: boolean;
  error?: string;
  txSignature?: string;
  solscanUrl?: string;
  txSizeBytes?: number;
  escrowPubkey?: string;
  mintPubkey?: string;
  mintMatch?: boolean;
  poolSol?: number;
  contributors?: number;
  initialBuySol?: number;
  logs?: string[];
}

interface Props {
  launches: Launch[];
  adminWallet: string;
}

export default function LocalSigningTestTab({ launches, adminWallet }: Props) {
  const [launchId, setLaunchId] = useState<string>("");
  const [mode, setMode] = useState<"dry" | "live">("dry");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const eligibleLaunches = useMemo(
    () =>
      launches
        .filter(
          (l) =>
            l.platform === "pumpfun" && !!l.pumpfun_mint_keypair_encrypted
        )
        .sort((a, b) => a.token_symbol.localeCompare(b.token_symbol)),
    [launches]
  );

  const selected = eligibleLaunches.find((l) => l.id === launchId) ?? null;
  const liveBlocked = mode === "live" && selected && selected.status !== "executing";

  const handleRun = async () => {
    if (!launchId) return;
    setRunning(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "test-local-signing",
        {
          body: {
            launchId,
            adminWallet,
            dryRun: mode === "dry",
          },
        }
      );
      if (error) {
        // Edge function returns structured body even on non-2xx; try to read it
        const ctx: any = (error as any)?.context;
        let parsed: RunResult | null = null;
        try {
          if (ctx?.body) parsed = JSON.parse(await ctx.text());
        } catch {
          /* noop */
        }
        setResult(
          parsed ?? {
            ok: false,
            error: error.message ?? "request failed",
            logs: [],
          }
        );
        toast.error(parsed?.error ?? error.message ?? "Request failed");
      } else {
        setResult(data as RunResult);
        if ((data as RunResult).ok) {
          toast.success(
            mode === "dry" ? "Dry run completed" : "Live submission succeeded"
          );
        } else {
          toast.error((data as RunResult).error ?? "Test failed");
        }
      }
    } catch (e: any) {
      setResult({ ok: false, error: e?.message ?? String(e), logs: [] });
      toast.error(e?.message ?? "Unexpected error");
    } finally {
      setRunning(false);
    }
  };

  const onClickRun = () => {
    if (mode === "live") setConfirmOpen(true);
    else handleRun();
  };

  const copyLogs = async () => {
    if (!result?.logs?.length) return;
    await navigator.clipboard.writeText(result.logs.join("\n"));
    toast.success("Logs copied");
  };

  return (
    <div className="space-y-6">
      {/* Warning */}
      <div className="border border-destructive/50 bg-destructive/5 p-4 flex gap-3">
        <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-mono text-xs uppercase tracking-widest text-destructive">
            Alternative launch path
          </div>
          <p className="text-sm text-muted-foreground">
            Invokes the PumpPortal{" "}
            <code className="font-mono text-xs">/trade-local</code> endpoint and
            signs the transaction locally with the launch's existing escrow +
            mint keypairs. Bypasses the worker and the{" "}
            <code className="font-mono text-xs">USE_LOCAL_SIGNING</code> flag.
            Always start with a dry run.
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="border border-border bg-card p-6 space-y-6">
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-widest">
            Pump.fun Launch
          </Label>
          <Select value={launchId} onValueChange={setLaunchId}>
            <SelectTrigger className="rounded-none font-mono text-sm">
              <SelectValue placeholder="Select a pumpfun launch" />
            </SelectTrigger>
            <SelectContent>
              {eligibleLaunches.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  No eligible pumpfun launches found
                </div>
              ) : (
                eligibleLaunches.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    <span className="font-mono text-xs">
                      {l.token_symbol} · {l.status} · {l.id.slice(0, 8)}
                    </span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          {selected && (
            <p className="text-xs text-muted-foreground font-mono">
              {selected.token_name} · status:{" "}
              <span
                className={
                  selected.status === "executing"
                    ? "text-primary"
                    : "text-muted-foreground"
                }
              >
                {selected.status}
              </span>
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-widest">
            Mode
          </Label>
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as "dry" | "live")}
            className="flex flex-col gap-2"
          >
            <div className="flex items-start gap-2">
              <RadioGroupItem value="dry" id="mode-dry" className="mt-1" />
              <Label htmlFor="mode-dry" className="cursor-pointer font-normal">
                <div className="font-mono text-sm">Dry run</div>
                <div className="text-xs text-muted-foreground">
                  Load keypairs, fetch /trade-local, sign locally. No RPC submit.
                  No DB writes.
                </div>
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="live" id="mode-live" className="mt-1" />
              <Label htmlFor="mode-live" className="cursor-pointer font-normal">
                <div className="font-mono text-sm text-destructive">
                  Live submit
                </div>
                <div className="text-xs text-muted-foreground">
                  Submits to Solana RPC and marks the launch as launched.
                  Requires status='executing'.
                </div>
              </Label>
            </div>
          </RadioGroup>
        </div>

        {liveBlocked && (
          <div className="border border-destructive/50 bg-destructive/5 p-3 text-xs font-mono text-destructive">
            Live mode requires status='executing'. Selected launch is
            '{selected?.status}'.
          </div>
        )}

        <Button
          onClick={onClickRun}
          disabled={!launchId || running || !!liveBlocked}
          className="rounded-none font-mono uppercase tracking-widest"
          variant={mode === "live" ? "destructive" : "default"}
        >
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Running...
            </>
          ) : (
            <>Run {mode === "live" ? "Live" : "Dry"} Test</>
          )}
        </Button>
      </div>

      {/* Result */}
      {result && (
        <div className="border border-border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Result
            </span>
            {result.ok ? (
              <span className="flex items-center gap-1 text-primary font-mono text-xs">
                <CheckCircle2 className="h-4 w-4" /> OK
                {result.dryRun ? " (DRY RUN)" : " (LIVE)"}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-destructive font-mono text-xs">
                <XCircle className="h-4 w-4" /> FAILED
              </span>
            )}
          </div>

          {result.error && (
            <div className="border border-destructive/50 bg-destructive/5 p-3 text-xs font-mono text-destructive break-all">
              {result.error}
            </div>
          )}

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {result.txSizeBytes != null && (
              <DetailRow label="Tx size" value={`${result.txSizeBytes} bytes`} />
            )}
            {result.poolSol != null && (
              <DetailRow label="Pool" value={`${result.poolSol} SOL`} />
            )}
            {result.contributors != null && (
              <DetailRow label="Contributors" value={String(result.contributors)} />
            )}
            {result.initialBuySol != null && (
              <DetailRow
                label="Initial buy"
                value={`${result.initialBuySol.toFixed(6)} SOL`}
              />
            )}
            {result.escrowPubkey && (
              <DetailRow label="Escrow" value={result.escrowPubkey} mono />
            )}
            {result.mintPubkey && (
              <DetailRow
                label="Mint"
                value={result.mintPubkey}
                mono
                badge={
                  result.mintMatch ? (
                    <span className="text-primary text-xs">✓ matches</span>
                  ) : (
                    <span className="text-destructive text-xs">✗ mismatch</span>
                  )
                }
              />
            )}
            {result.txSignature && (
              <DetailRow label="Tx signature" value={result.txSignature} mono />
            )}
          </dl>

          {result.solscanUrl && (
            <a
              href={result.solscanUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary font-mono text-xs underline"
            >
              View on Solscan <ExternalLink className="h-3 w-3" />
            </a>
          )}

          {result.logs && result.logs.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  Logs
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyLogs}
                  className="rounded-none h-7 px-2"
                >
                  <Copy className="h-3 w-3 mr-1" /> Copy
                </Button>
              </div>
              <pre className="bg-background border border-border p-3 text-xs font-mono overflow-x-auto max-h-80 whitespace-pre-wrap break-all">
                {result.logs.join("\n")}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Confirmation dialog for live mode */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="rounded-none">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono uppercase tracking-widest text-destructive">
              Confirm live submission
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                This will submit a real Solana transaction using{" "}
                <code className="font-mono">/trade-local</code> + local signing
                and mark the launch as <strong>launched</strong>.
              </span>
              <span className="block font-mono text-xs">
                {selected?.token_symbol} · {selected?.id}
              </span>
              <span className="block">There is no undo. Proceed?</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-none">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRun}
              className="rounded-none bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Submit live
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
  badge,
}: {
  label: string;
  value: string;
  mono?: boolean;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <dt className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`break-all flex items-center gap-2 ${
          mono ? "font-mono text-xs" : "text-sm"
        }`}
      >
        <span>{value}</span>
        {badge}
      </dd>
    </div>
  );
}