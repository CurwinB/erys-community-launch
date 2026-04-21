import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import LaunchCard from "@/components/LaunchCard";
import { supabase } from "@/integrations/supabase/client";
import { Coins, Clock, Shield, ArrowDown } from "lucide-react";

const Index = () => {
  const { data: liveLaunches, isLoading: liveLaunchesLoading } = useQuery({
    queryKey: ["launches", "live"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("launches")
        .select("*")
        .eq("status", "scheduled")
        .gte("launch_datetime", new Date().toISOString())
        .order("launch_datetime", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: completedLaunches, isLoading: completedLoading } = useQuery({
    queryKey: ["launches", "completed"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("launches")
        .select("*")
        .eq("status", "launched")
        .order("launch_datetime", { ascending: false })
        .limit(6);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch contribution stats for live launches
  const { data: contributionStats } = useQuery({
    queryKey: ["contribution-stats", liveLaunches?.map((l) => l.id)],
    enabled: !!liveLaunches && liveLaunches.length > 0,
    refetchInterval: 30000,
    queryFn: async () => {
      if (!liveLaunches) return {};
      const ids = liveLaunches.map((l) => l.id);
      const { data, error } = await supabase
        .from("contributions")
        .select("launch_id, amount_lamports")
        .in("launch_id", ids);
      if (error) throw error;

      const stats: Record<string, { total: number; count: number }> = {};
      (data || []).forEach((c) => {
        if (!stats[c.launch_id]) stats[c.launch_id] = { total: 0, count: 0 };
        stats[c.launch_id].total += Number(c.amount_lamports);
        stats[c.launch_id].count += 1;
      });
      return stats;
    },
  });

  const features = [
    {
      icon: Coins,
      title: "Two Platforms.",
      body: "Choose Bags.fm for perpetual fee sharing or Pump.fun for early entry token positions.",
    },
    {
      icon: Clock,
      title: "Community First.",
      body: "Contributors get in before the token goes live and share in the upside from day one.",
    },
    {
      icon: Shield,
      title: "Transparent Escrow.",
      body: "SOL is held securely until launch. If it doesn't launch you get refunded automatically.",
    },
  ];

  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="border-b border-border">
        <div className="container mx-auto px-4 py-20 md:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-sm border border-primary/30 bg-primary/5 px-3 py-1.5">
              <span className="text-xs font-medium text-primary">Launch on Bags.fm or Pump.fun</span>
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-foreground md:text-6xl">
              The Community Launch Platform for Solana Tokens.
            </h1>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link to="/schedule">
                <Button size="lg" className="w-full sm:w-auto">
                  Schedule a Launch
                </Button>
              </Link>
              <Button
                variant="outline"
                size="lg"
                className="w-full sm:w-auto"
                onClick={() =>
                  document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })
                }
              >
                How it works
                <ArrowDown className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Live Launches */}
      <section id="launches" className="border-b border-border">
        <div className="container mx-auto px-4 py-16">
          {liveLaunchesLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-72 animate-pulse rounded-sm border border-border bg-card" />
              ))}
            </div>
          ) : liveLaunches && liveLaunches.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {liveLaunches.map((launch, i) => {
                const stats = contributionStats?.[launch.id];
                return (
                  <LaunchCard
                    key={launch.id}
                    id={launch.id}
                    tokenName={launch.token_name}
                    tokenSymbol={launch.token_symbol}
                    imageUrl={launch.image_url}
                    launchDatetime={launch.launch_datetime}
                    totalEscrowLamports={stats?.total || 0}
                    contributorCount={stats?.count || 0}
                    minContributionLamports={Number(launch.min_contribution_lamports)}
                    status="scheduled"
                    platform={(launch.platform as "bags" | "pumpfun") || "bags"}
                    animationDelay={i * 100}
                  />
                );
              })}
            </div>
          ) : (
            <div className="mx-auto flex max-w-md flex-col items-center justify-center border border-border bg-card px-6 py-12 text-center">
              <p className="mb-6 text-muted-foreground">No launches scheduled yet.</p>
              <Link to="/schedule">
                <Button>Schedule the First Launch</Button>
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Completed Launches */}
      <section>
        <div className="container mx-auto px-4 py-16">
          <h2 className="mb-8 text-2xl font-bold text-foreground">Completed Launches</h2>

          {completedLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-48 animate-pulse rounded-sm border border-border bg-card" />
              ))}
            </div>
          ) : completedLaunches && completedLaunches.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 opacity-75">
              {completedLaunches.map((launch, i) => (
                <LaunchCard
                  key={launch.id}
                  id={launch.id}
                  tokenName={launch.token_name}
                  tokenSymbol={launch.token_symbol}
                  imageUrl={launch.image_url}
                  launchDatetime={launch.launch_datetime}
                  totalEscrowLamports={0}
                  contributorCount={0}
                  minContributionLamports={Number(launch.min_contribution_lamports)}
                  status="launched"
                  platform={(launch.platform as "bags" | "pumpfun") || "bags"}
                  animationDelay={i * 100}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-sm border border-dashed border-border py-12">
              <p className="text-muted-foreground">No completed launches yet.</p>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      {/* How it works */}
      <section id="how-it-works" className="border-t border-border">
        <div className="container mx-auto px-4 py-16">
          <h2 className="mb-8 text-2xl font-bold text-foreground">How it works</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="border border-border border-t-primary bg-card p-6"
              >
                <f.icon className="mb-3 h-5 w-5 text-primary" />
                <h3 className="mb-2 font-semibold text-foreground">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8">
        <div className="container mx-auto flex flex-col items-center gap-2 px-4 text-center">
          <span className="text-sm text-muted-foreground">
            erys<span className="text-primary">.</span> — Launch on{" "}
            <a href="https://bags.fm" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary transition-colors">
              Bags.fm
            </a>{" "}
            or{" "}
            <a href="https://pump.fun" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary transition-colors">
              Pump.fun
            </a>
          </span>
          <span className="text-xs text-muted-foreground">Every token launched through Erys is a real on-chain Solana token.</span>
        </div>
      </footer>
    </main>
  );
};

export default Index;
