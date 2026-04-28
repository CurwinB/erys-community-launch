import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { Users, Coins, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import CountdownTimer from "@/components/CountdownTimer";
import { formatSol } from "@/lib/constants";

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
          <span className="text-[10px] font-medium uppercase tracking-wider text-success">Live</span>
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
          </div>
          <span className="font-mono text-xs text-muted-foreground">${tokenSymbol}</span>
        </div>
      </div>

      <div className="flex-1 p-4 space-y-4">
        {isLive && (
          <div>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Launches in</span>
            <CountdownTimer targetDate={launchDatetime} size="sm" className="mt-1" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <Coins className="h-3.5 w-3.5 text-primary" />
            <div>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Escrow</span>
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
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Min Contribution</span>
          <p className="font-mono text-xs text-foreground">{formatSol(minContributionLamports)} SOL</p>
        </div>
      </div>

      <div className="border-t border-border p-4">
        <div className="flex items-center gap-2">
          <Link to={`/launch/${id}`} className="flex-1">
            <Button className="w-full" size="sm">
              {isLive ? "Participate" : "View Details"}
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
