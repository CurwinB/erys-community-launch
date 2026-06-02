import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { Users, Coins, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import CountdownTimer from "@/components/CountdownTimer";
import { formatSol } from "@/lib/constants";
import PreparednessBadge from "@/components/launch/PreparednessBadge";
import CategoryBadge from "@/components/launch/CategoryBadge";
import type { PreparednessTier } from "@/lib/preparedness";

interface LaunchCardProps {
  id: string;
  tokenName: string;
  tokenSymbol: string;
  imageUrl?: string | null;
  launchDatetime: string;
  totalEscrowLamports: number;
  contributorCount: number;
  minContributionLamports: number;
  status: "scheduled" | "launched";
  platform?: "bags" | "pumpfun";
  animationDelay?: number;
  variant?: "card" | "row";
  preparednessTier?: PreparednessTier;
  category?: string | null;
}

const LaunchCard = ({
  id,
  tokenName,
  tokenSymbol,
  imageUrl,
  launchDatetime,
  totalEscrowLamports,
  contributorCount,
  minContributionLamports,
  status,
  platform = "bags",
  animationDelay = 0,
  variant = "card",
  preparednessTier = "none",
  category = null,
}: LaunchCardProps) => {
  const isLive = status === "scheduled";
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const shareUrl = `${window.location.origin}/launch/${id}`;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (variant === "row") {
    return (
      <RowVariant
        id={id}
        tokenName={tokenName}
        tokenSymbol={tokenSymbol}
        imageUrl={imageUrl}
        launchDatetime={launchDatetime}
        totalEscrowLamports={totalEscrowLamports}
        contributorCount={contributorCount}
        status={status}
        platform={platform}
        animationDelay={animationDelay}
        copied={copied}
        onCopy={handleCopy}
        preparednessTier={preparednessTier}
        category={category}
      />
    );
  }

  return (
    <div
      className="group relative flex flex-col overflow-hidden border border-border bg-card transition-all duration-300 hover:border-primary/30 hover:glow-cyan opacity-0 animate-fade-in"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      {isLive && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-success animate-pulse-glow" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-success">Presale Live</span>
        </div>
      )}

      <div className="flex items-center gap-3 border-b border-border p-4">
        <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-sm bg-muted">
          {imageUrl ? (
            <img src={imageUrl} alt={tokenName} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-lg font-bold text-muted-foreground">
              {tokenSymbol.charAt(0)}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold text-foreground">{tokenName}</h3>
            {platform === "pumpfun" ? (
              <span className="rounded-sm border border-[#00FF88]/30 bg-[#00FF88]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#00FF88]">
                Pump
              </span>
            ) : (
              <span className="rounded-sm border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
                Bags
              </span>
            )}
            <CategoryBadge category={category} size="sm" />
            <PreparednessBadge tier={preparednessTier} size="sm" />
          </div>
          <span className="font-mono text-xs text-muted-foreground">${tokenSymbol}</span>
        </div>
      </div>

      <div className="flex-1 p-4 space-y-4">
        {isLive && (
          <div>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Presale ends in</span>
            <CountdownTimer targetDate={launchDatetime} size="sm" className="mt-1" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <Coins className="h-3.5 w-3.5 text-primary" />
            <div>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Raised</span>
              <p className="font-mono text-sm font-semibold text-foreground">{formatSol(totalEscrowLamports)} SOL</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-primary" />
            <div>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Contributors</span>
              <p className="font-mono text-sm font-semibold text-foreground">{contributorCount}</p>
            </div>
          </div>
        </div>

        <div>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Min Buy</span>
          <p className="font-mono text-xs text-foreground">{formatSol(minContributionLamports)} SOL</p>
        </div>
      </div>

      <div className="border-t border-border p-4">
        <div className="flex items-center gap-2">
          <Link to={`/launch/${id}`} className="flex-1">
            <Button className="w-full" size="sm">
              {isLive ? "Ape In" : "View Token"}
            </Button>
          </Link>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-9 w-9 flex-shrink-0"
            onClick={handleCopy}
            aria-label="Copy launch link"
            title={copied ? "Copied" : "Copy link"}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default LaunchCard;

function formatCompactCountdown(target: string): string {
  const diff = new Date(target).getTime() - Date.now();
  if (diff <= 0) return "00:00";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `${days}d ${pad(hours)}:${pad(minutes)}`;
  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

interface RowVariantProps {
  id: string;
  tokenName: string;
  tokenSymbol: string;
  imageUrl?: string | null;
  launchDatetime: string;
  totalEscrowLamports: number;
  contributorCount: number;
  status: "scheduled" | "launched";
  platform: "bags" | "pumpfun";
  animationDelay: number;
  copied: boolean;
  onCopy: (e: React.MouseEvent) => void;
  preparednessTier?: PreparednessTier;
  category?: string | null;
}

const RowVariant = ({
  id,
  tokenName,
  tokenSymbol,
  imageUrl,
  launchDatetime,
  totalEscrowLamports,
  contributorCount,
  status,
  platform,
  animationDelay,
  copied,
  onCopy,
  preparednessTier = "none",
  category = null,
}: RowVariantProps) => {
  const isLive = status === "scheduled";
  const [countdown, setCountdown] = useState(() => formatCompactCountdown(launchDatetime));

  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setCountdown(formatCompactCountdown(launchDatetime)), 1000);
    return () => clearInterval(id);
  }, [launchDatetime, isLive]);

  return (
    <Link
      to={`/launch/${id}`}
      className="group flex items-center gap-3 bg-card px-3 py-2.5 transition-colors hover:bg-muted/30 opacity-0 animate-fade-in"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-sm bg-muted">
        {imageUrl ? (
          <img src={imageUrl} alt={tokenName} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm font-bold text-muted-foreground">
            {tokenSymbol.charAt(0)}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate text-sm font-semibold text-foreground">{tokenName}</h3>
          {platform === "pumpfun" ? (
            <span className="flex-shrink-0 rounded-sm border border-[#00FF88]/30 bg-[#00FF88]/10 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-[#00FF88]">
              Pump
            </span>
          ) : (
            <span className="flex-shrink-0 rounded-sm border border-primary/30 bg-primary/10 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-primary">
              Bags
            </span>
          )}
          <CategoryBadge category={category} size="sm" />
          <PreparednessBadge tier={preparednessTier} size="sm" />
        </div>
        <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <span className="truncate">${tokenSymbol}</span>
          {isLive && (
            <>
              <span className="text-border">·</span>
              <span className="text-foreground">{formatSol(totalEscrowLamports)}◎</span>
              <span className="text-border">·</span>
              <span>{contributorCount}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
        {isLive ? (
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-glow" />
              <span className="text-[9px] font-medium uppercase tracking-wider text-success">Live Presale</span>
            </div>
            <span className="font-mono text-xs font-semibold text-primary">{countdown}</span>
          </div>
        ) : (
           <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Launched</span>
        )}
        <button
          type="button"
          onClick={onCopy}
          aria-label="Copy launch link"
          title={copied ? "Copied" : "Copy link"}
          className="flex h-7 w-7 items-center justify-center border border-border text-muted-foreground transition-colors hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
    </Link>
  );
};
