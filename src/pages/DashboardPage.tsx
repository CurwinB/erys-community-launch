import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DynamicWidget } from "@dynamic-labs/sdk-react-core";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import StatusBadge from "@/components/StatusBadge";
import Seo from "@/components/Seo";
import { formatSol, shortenAddress, lamportsToSol } from "@/lib/constants";
import { formatDate, formatInt } from "@/lib/adminFormat";
import { toast } from "@/hooks/use-toast";
import { useWallet } from "@/hooks/useWallet";
import { useDashboardNotifications } from "@/hooks/useDashboardNotifications";
import {
  Wallet,
  Coins,
  Rocket,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Bell,
  X,
  Clock,
} from "lucide-react";

type Tab = "notifications" | "tokens" | "fees" | "contributions";

const tabs: { id: Tab; label: string }[] = [
  { id: "notifications", label: "Notifications" },
  { id: "tokens", label: "My Tokens" },
  { id: "fees", label: "My Fees" },
  { id: "contributions", label: "My Contributions" },
];

const tradeUrl = (platform: string | undefined, mint: string | null | undefined) => {
  if (!mint) return "#";
  return platform === "pumpfun"
    ? `https://pump.fun/${mint}`
    : `https://bags.fm/token/${mint}`;
};

const platformLabel = (platform: string | undefined) =>
  platform === "pumpfun" ? "Pump.fun" : "Bags.fm";

function timeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "any moment";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMin = mins % 60;
  return `${hrs}h ${remMin}m`;
}

const DashboardPage = () => {
  const [activeTab, setActiveTab] = useState<Tab>("notifications");
  const [claimingMint, setClaimingMint] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);
  const queryClient = useQueryClient();
  const { connected, publicKey, wallet } = useWallet();
  const walletAddress = publicKey || "";

  const {
    contributions,
    getClaimableForMint,
    tokenNotifications,
    feeNotifications,
    upcomingNotifications,
    dismiss,
    isLoading,
  } = useDashboardNotifications();

  const claimMutation = useMutation({
    mutationFn: async (mint: string) => {
      if (!wallet) throw new Error("Wallet not connected");
      const { data, error } = await supabase.functions.invoke("claim-fees", {
        body: { action: "claim", wallet: walletAddress, mint },
      });
      if (error) throw error;
      const signer = await wallet.getSigner();
      const txBytes = Uint8Array.from(atob(data.transaction), (c) => c.charCodeAt(0));
      const { VersionedTransaction } = await import("@solana/web3.js");
      const versionedTx = VersionedTransaction.deserialize(txBytes);
      const signed = await signer.signTransaction(versionedTx as any);
      const serializedSigned = btoa(
        String.fromCharCode(...new Uint8Array(signed.serialize()))
      );
      const { error: sendErr } = await supabase.functions.invoke("claim-fees", {
        body: { action: "send", transaction: serializedSigned },
      });
      if (sendErr) throw sendErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["claimable-positions"] });
    },
  });

  const handleClaim = async (mint: string) => {
    setClaimingMint(mint);
    try {
      await claimMutation.mutateAsync(mint);
      toast({ title: "Fees claimed", description: "Your claim transaction was confirmed." });
    } catch (err: any) {
      toast({ title: "Claim failed", description: err.message, variant: "destructive" });
    } finally {
      setClaimingMint(null);
    }
  };

  const safeContributions = useMemo(
    () => (Array.isArray(contributions) ? contributions.filter((c) => c && c.launches) : []),
    [contributions]
  );

  const bagsContributions = useMemo(
    () => safeContributions.filter((c) => c.launches?.platform === "bags"),
    [safeContributions]
  );

  const uniqueClaimableMints = useMemo(() => {
    const mints = bagsContributions
      .filter((c) => c.is_fee_claimer !== false && c.launches?.token_mint_address)
      .map((c) => c.launches.token_mint_address as string);
    return Array.from(new Set(mints));
  }, [bagsContributions]);

  const totalClaimable = useMemo(() => {
    const sum = uniqueClaimableMints.reduce(
      (acc, m) => acc + (Number(getClaimableForMint(m)) || 0),
      0
    );
    return Number.isFinite(sum) ? sum : 0;
  }, [uniqueClaimableMints, getClaimableForMint]);

  const distributedContributions = useMemo(
    () => safeContributions.filter((c) => c.tokens_distributed),
    [safeContributions]
  );

  const handleClaimAll = async () => {
    const targets = uniqueClaimableMints.filter((m) => getClaimableForMint(m) > 0);
    if (targets.length === 0) return;
    setClaimingAll(true);
    let ok = 0;
    let failed = 0;
    for (const mint of targets) {
      try {
        await claimMutation.mutateAsync(mint);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setClaimingAll(false);
    toast({
      title: "Claim All complete",
      description: `${ok} succeeded${failed ? `, ${failed} failed` : ""}.`,
      variant: failed > 0 ? "destructive" : "default",
    });
  };

  if (!connected) {
    return (
      <main className="min-h-screen">
        <Seo
          title="Dashboard — Erys"
          description="View your contributions, claim trading fees, and track distributions."
          path="/dashboard"
          noindex
        />
        <div className="container mx-auto flex min-h-[60vh] flex-col items-center justify-center px-4">
          <Wallet className="mb-4 h-12 w-12 text-muted-foreground" />
          <h2 className="mb-2 text-xl font-bold text-foreground">Connect your wallet</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Connect your wallet to view your dashboard.
          </p>
          <DynamicWidget />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <Seo
        title="Dashboard — Erys"
        description="Your tokens, fees, contributions, and notifications."
        path="/dashboard"
        noindex
      />
      <div className="container mx-auto px-4 py-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-foreground md:text-3xl">Dashboard.</h1>
          <span className="rounded-sm border border-border bg-card px-2.5 py-1 font-mono text-xs text-muted-foreground">
            {shortenAddress(walletAddress, 6)}
          </span>
        </div>

        <div className="mt-8 flex gap-1 overflow-x-auto border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === t.id
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : activeTab === "notifications" ? (
            <NotificationsTab
              tokenNotifications={tokenNotifications}
              feeNotifications={feeNotifications}
              upcomingNotifications={upcomingNotifications}
              getClaimableForMint={getClaimableForMint}
              dismiss={dismiss}
              onClaim={handleClaim}
              claimingMint={claimingMint}
            />
          ) : activeTab === "tokens" ? (
            <TokensTab contributions={distributedContributions} />
          ) : activeTab === "fees" ? (
            <FeesTab
              bagsContributions={bagsContributions}
              getClaimableForMint={getClaimableForMint}
              totalClaimable={totalClaimable}
              onClaim={handleClaim}
              onClaimAll={handleClaimAll}
              claimingMint={claimingMint}
              claimingAll={claimingAll}
            />
          ) : (
            <ContributionsTab contributions={contributions} />
          )}
        </div>
      </div>
    </main>
  );
};

/* ---------- Notifications ---------- */

const NotificationsTab = ({
  tokenNotifications,
  feeNotifications,
  upcomingNotifications,
  getClaimableForMint,
  dismiss,
  onClaim,
  claimingMint,
}: {
  tokenNotifications: any[];
  feeNotifications: any[];
  upcomingNotifications: any[];
  getClaimableForMint: (mint: string | null | undefined) => number;
  dismiss: (id: string) => void;
  onClaim: (mint: string) => void;
  claimingMint: string | null;
}) => {
  const empty =
    tokenNotifications.length === 0 &&
    feeNotifications.length === 0 &&
    upcomingNotifications.length === 0;

  if (empty) {
    return (
      <div className="flex flex-col items-center justify-center rounded-sm border border-dashed border-border py-12">
        <Bell className="mb-3 h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">No new notifications</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Token distributions and claimable fees will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tokenNotifications.map((c) => {
        const l = c.launches;
        return (
          <div
            key={`tok-${c.id}`}
            className="flex items-start justify-between gap-3 border border-success/40 bg-success/5 p-4"
          >
            <div className="flex items-start gap-3">
              <TokenAvatar image={l?.image_url} symbol={l?.token_symbol} />
              <div>
                <p className="text-[10px] uppercase tracking-widest text-success">
                  Tokens received
                </p>
                <p className="mt-0.5 text-sm text-foreground">
                  You received{" "}
                  <span className="font-mono font-semibold">
                    {formatInt(c.token_amount)}
                  </span>{" "}
                  ${l?.token_symbol} from {l?.token_name}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDate(l?.distribution_completed_at)}
                </p>
                <a
                  href={tradeUrl(l?.platform, l?.token_mint_address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Trade on {platformLabel(l?.platform)} →
                </a>
              </div>
            </div>
            <button
              onClick={() => dismiss(c.id)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}

      {feeNotifications.map((c) => {
        const l = c.launches;
        const mint = l?.token_mint_address;
        const claimable = getClaimableForMint(mint);
        const isClaiming = claimingMint === mint;
        return (
          <div
            key={`fee-${c.id}`}
            className="flex items-center justify-between gap-3 border border-amber-500/40 bg-amber-500/5 p-4"
          >
            <div className="flex items-start gap-3">
              <TokenAvatar image={l?.image_url} symbol={l?.token_symbol} />
              <div>
                <p className="text-[10px] uppercase tracking-widest text-amber-400">
                  Trading fees available
                </p>
                <p className="mt-0.5 text-sm text-foreground">
                  You have{" "}
                  <span className="font-mono font-semibold">{claimable.toFixed(4)} SOL</span>{" "}
                  in claimable fees from {l?.token_name}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              disabled={!mint || isClaiming}
              onClick={() => mint && onClaim(mint)}
              className="gap-1"
            >
              {isClaiming ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Claim
            </Button>
          </div>
        );
      })}

      {upcomingNotifications.map((c) => {
        const l = c.launches;
        return (
          <div
            key={`up-${c.id}`}
            className="flex items-start gap-3 border border-primary/40 bg-primary/5 p-4"
          >
            <Clock className="mt-0.5 h-5 w-5 text-primary shrink-0" />
            <div>
              <p className="text-[10px] uppercase tracking-widest text-primary">
                Launch executing soon
              </p>
              <p className="mt-0.5 text-sm text-foreground">
                {l?.token_name} launches in{" "}
                <span className="font-mono font-semibold">
                  {timeUntil(l?.launch_datetime)}
                </span>
                . Your{" "}
                <span className="font-mono">
                  {lamportsToSol(Number(c.amount_lamports)).toFixed(4)} SOL
                </span>{" "}
                is in escrow.
              </p>
              <Link
                to={`/launch/${l?.id}`}
                className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                View launch →
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ---------- My Tokens ---------- */

const TokensTab = ({ contributions }: { contributions: any[] }) => {
  if (contributions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-sm border border-dashed border-border py-12">
        <Coins className="mb-3 h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">No tokens yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Contribute to a launch to receive tokens.
        </p>
        <Link to="/" className="mt-4">
          <Button size="sm" variant="outline">
            View launches →
          </Button>
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {contributions.map((c) => {
        const l = c.launches;
        return (
          <div key={c.id} className="border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <TokenAvatar image={l?.image_url} symbol={l?.token_symbol} />
                <div>
                  <p className="font-semibold text-foreground">{l?.token_name}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    ${l?.token_symbol}
                  </p>
                  <span className="mt-1 inline-block rounded-sm border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {platformLabel(l?.platform)}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <p className="font-mono text-lg font-semibold text-foreground">
                  {formatInt(c.token_amount)}
                </p>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  tokens received
                </p>
                <a
                  href={tradeUrl(l?.platform, l?.token_mint_address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Trade <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
            <div className="mt-3 flex justify-between border-t border-border pt-2 font-mono text-[11px] text-muted-foreground">
              <span>Contributed {formatSol(Number(c.amount_lamports))} SOL</span>
              <span>Received {formatDate(l?.distribution_completed_at)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ---------- My Fees ---------- */

const FeesTab = ({
  bagsContributions,
  getClaimableForMint,
  totalClaimable,
  onClaim,
  onClaimAll,
  claimingMint,
  claimingAll,
}: {
  bagsContributions: any[];
  getClaimableForMint: (mint: string | null | undefined) => number;
  totalClaimable: number;
  onClaim: (mint: string) => void;
  onClaimAll: () => void;
  claimingMint: string | null;
  claimingAll: boolean;
}) => {
  if (bagsContributions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-sm border border-dashed border-border py-12">
        <Coins className="mb-3 h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">No fee positions</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Contribute to a Bags.fm launch to earn permanent trading fees.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between border border-border bg-card p-6">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Total claimable
          </p>
          <p className="mt-1 font-mono text-3xl font-bold text-primary">
            {totalClaimable.toFixed(4)} SOL
          </p>
        </div>
        <Button
          size="sm"
          disabled={totalClaimable <= 0 || claimingAll}
          onClick={onClaimAll}
          className="gap-2"
        >
          {claimingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Claim All
        </Button>
      </div>

      {bagsContributions.map((c) => {
        const l = c.launches;
        const mint = l?.token_mint_address;
        const claimable = getClaimableForMint(mint);
        const isExcluded = c.is_fee_claimer === false;
        const isClaiming = claimingMint === mint;
        return (
          <div key={c.id} className="border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <TokenAvatar image={l?.image_url} symbol={l?.token_symbol} />
                <div>
                  <p className="font-semibold text-foreground">{l?.token_name}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    ${l?.token_symbol}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-mono text-lg font-semibold text-foreground">
                  {claimable.toFixed(4)} SOL
                </p>
                {!isExcluded && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1 gap-1"
                    disabled={!mint || claimable <= 0 || isClaiming}
                    onClick={() => mint && onClaim(mint)}
                  >
                    {isClaiming ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    {claimable <= 0 ? "No fees yet" : "Claim"}
                  </Button>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-border pt-2 font-mono text-[11px] text-muted-foreground">
              <span>
                Your share:{" "}
                {c.basis_points != null ? `${(c.basis_points / 100).toFixed(2)}%` : "—"}
              </span>
              <span>Contributed {formatSol(Number(c.amount_lamports))} SOL</span>
            </div>
            {isExcluded && (
              <div className="mt-3 flex items-start gap-2 rounded-sm border border-destructive/30 bg-destructive/5 p-2.5">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">
                  Excluded from fee share due to 100 claimer limit. Your SOL was still used in
                  the launch.
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* ---------- My Contributions ---------- */

const ContributionsTab = ({ contributions }: { contributions: any[] }) => {
  if (contributions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-sm border border-dashed border-border py-12">
        <Rocket className="mb-3 h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No contributions yet.</p>
        <Link to="/" className="mt-3">
          <Button size="sm" variant="outline">
            Browse launches
          </Button>
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {contributions.map((c) => {
        const l = c.launches;
        return (
          <div key={c.id} className="border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <TokenAvatar image={l?.image_url} symbol={l?.token_symbol} />
                <div>
                  <p className="font-semibold text-foreground">{l?.token_name}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    ${l?.token_symbol}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-semibold text-foreground">
                  {formatSol(Number(c.amount_lamports))} SOL
                </p>
                <div className="mt-1">
                  <StatusBadge status={l?.status || "scheduled"} />
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-2 font-mono text-[11px] text-muted-foreground sm:grid-cols-4">
              <span>Platform: {platformLabel(l?.platform)}</span>
              <span>Date: {formatDate(c.contributed_at)}</span>
              <span>
                Tokens:{" "}
                {c.tokens_distributed ? formatInt(c.token_amount) : "Pending"}
              </span>
              <Link
                to={`/launch/${l?.id}`}
                className="text-primary hover:underline sm:text-right"
              >
                View launch →
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ---------- Shared bits ---------- */

const TokenAvatar = ({
  image,
  symbol,
}: {
  image?: string | null;
  symbol?: string | null;
}) => {
  if (image) {
    return (
      <img
        src={image}
        alt={symbol || "token"}
        className="h-10 w-10 rounded-sm object-cover"
      />
    );
  }
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-muted text-sm font-bold text-muted-foreground">
      {symbol?.charAt(0) || "?"}
    </div>
  );
};

export default DashboardPage;
