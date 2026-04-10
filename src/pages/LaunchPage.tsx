import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CountdownTimer from "@/components/CountdownTimer";
import StatusBadge from "@/components/StatusBadge";
import { formatSol, shortenAddress } from "@/lib/constants";
import { ExternalLink, Users, Coins, Wallet, ArrowRight } from "lucide-react";
import { useState } from "react";

const LaunchPage = () => {
  const { id } = useParams<{ id: string }>();
  const [solAmount, setSolAmount] = useState("");

  const { data: launch, isLoading } = useQuery({
    queryKey: ["launch", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("launches")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: contributions } = useQuery({
    queryKey: ["contributions", id],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contributions")
        .select("*")
        .eq("launch_id", id!)
        .order("contributed_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!id,
  });

  const totalEscrow = contributions?.reduce((sum, c) => sum + Number(c.amount_lamports), 0) || 0;
  const contributorCount = contributions?.length || 0;

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="h-64 animate-pulse rounded-sm border border-border bg-card" />
      </div>
    );
  }

  if (!launch) {
    return (
      <div className="container mx-auto flex min-h-[60vh] items-center justify-center px-4">
        <p className="text-muted-foreground">Launch not found.</p>
      </div>
    );
  }

  const maxContrib = launch.max_contribution_lamports ? Number(launch.max_contribution_lamports) : null;
  const progressPercent = maxContrib ? Math.min((totalEscrow / maxContrib) * 100, 100) : 0;

  return (
    <main className="min-h-screen">
      {/* Header */}
      <section className="border-b border-border bg-card">
        <div className="container mx-auto flex flex-col gap-6 px-4 py-8 md:flex-row md:items-center">
          <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-sm bg-muted">
            {launch.image_url ? (
              <img src={launch.image_url} alt={launch.token_name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-muted-foreground">
                {launch.token_symbol.charAt(0)}
              </div>
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground md:text-3xl">{launch.token_name}</h1>
              <span className="font-mono text-sm text-muted-foreground">${launch.token_symbol}</span>
              <StatusBadge status={launch.status as any} />
            </div>
            {launch.description && (
              <p className="mt-2 text-sm text-muted-foreground">{launch.description}</p>
            )}
            <div className="mt-3 flex gap-2">
              {launch.twitter_url && (
                <a href={launch.twitter_url} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="icon" className="h-8 w-8">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </a>
              )}
              {launch.telegram_url && (
                <a href={launch.telegram_url} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="icon" className="h-8 w-8">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </a>
              )}
              {launch.website_url && (
                <a href={launch.website_url} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="icon" className="h-8 w-8">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <div className="container mx-auto grid gap-6 px-4 py-8 lg:grid-cols-5">
        {/* Left column */}
        <div className="space-y-6 lg:col-span-3">
          {/* Countdown */}
          {launch.status === "scheduled" && (
            <div className="border border-border bg-card p-6">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Launches in</span>
              <CountdownTimer targetDate={launch.launch_datetime} size="lg" className="mt-3" />
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-primary" />
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">SOL in Escrow</span>
              </div>
              <p className="mt-2 font-mono text-2xl font-bold text-foreground">{formatSol(totalEscrow)}</p>
            </div>
            <div className="border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Contributors</span>
              </div>
              <p className="mt-2 font-mono text-2xl font-bold text-foreground">{contributorCount}</p>
            </div>
          </div>

          {/* Progress bar */}
          {maxContrib && (
            <div className="border border-border bg-card p-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Progress</span>
                <span className="font-mono">{progressPercent.toFixed(1)}%</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Contributor feed */}
          <div className="border border-border bg-card">
            <div className="border-b border-border p-4">
              <h3 className="text-sm font-semibold text-foreground">Recent Contributions</h3>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {contributions && contributions.length > 0 ? (
                contributions.map((c) => (
                  <div key={c.id} className="flex items-center justify-between border-b border-border px-4 py-3 last:border-0">
                    <span className="font-mono text-xs text-muted-foreground">{shortenAddress(c.wallet_address)}</span>
                    <span className="font-mono text-sm font-semibold text-primary">{formatSol(Number(c.amount_lamports))} SOL</span>
                  </div>
                ))
              ) : (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">No contributions yet. Be the first.</div>
              )}
            </div>
          </div>

          {/* Explainer */}
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { step: "1", title: "Contribute SOL", body: "Send SOL to the escrow before launch." },
              { step: "2", title: "Token Launches", body: "Launches automatically at scheduled time." },
              { step: "3", title: "Earn Forever", body: "Earn Bags trading fees proportional to your contribution." },
            ].map((s) => (
              <div key={s.step} className="flex items-start gap-3 border border-border bg-card p-4">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-sm bg-primary font-mono text-xs font-bold text-primary-foreground">
                  {s.step}
                </span>
                <div>
                  <h4 className="text-sm font-semibold text-foreground">{s.title}</h4>
                  <p className="text-xs text-muted-foreground">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right column - Contribution card */}
        <div className="lg:col-span-2">
          <div className="sticky top-20 space-y-4">
            <div className="border border-primary/30 bg-card p-6 space-y-5">
              <h3 className="font-semibold text-foreground">Contribute</h3>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Min: {formatSol(Number(launch.min_contribution_lamports))} SOL</span>
                  {maxContrib && <span>Max: {formatSol(maxContrib)} SOL</span>}
                </div>
                <div className="relative">
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={solAmount}
                    onChange={(e) => setSolAmount(e.target.value)}
                    className="pr-12 font-mono"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">SOL</span>
                </div>
              </div>

              <Button className="w-full gap-2">
                <Wallet className="h-4 w-4" />
                Connect Wallet to Contribute
              </Button>

              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Your SOL is held in escrow until launch. You will be registered as a permanent Bags fee share recipient proportional to your contribution. If this launch is cancelled your SOL is refunded automatically.
              </p>
            </div>

            <div className="flex items-center justify-center gap-2 border border-border bg-card p-3">
              <span className="text-[10px] text-muted-foreground">This token will be launched on</span>
              <a href="https://bags.fm" target="_blank" rel="noopener noreferrer" className="text-[10px] font-semibold text-foreground hover:text-primary transition-colors">
                Bags.fm
              </a>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};

export default LaunchPage;
