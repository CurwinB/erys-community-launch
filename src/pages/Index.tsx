import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import LaunchCard from "@/components/LaunchCard";
import Seo from "@/components/Seo";
import { supabase } from "@/integrations/supabase/client";
import { LAUNCH_PUBLIC_COLUMNS } from "@/lib/constants";
import { useIsMobile } from "@/hooks/use-mobile";
import { Coins, Clock, Shield, ArrowDown } from "lucide-react";

const Index = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const [completedPage, setCompletedPage] = useState(1);
  const LAUNCHES_PER_PAGE = 20;
  const isMobile = useIsMobile();

  const { data: liveLaunches, isLoading: liveLaunchesLoading } = useQuery({
    queryKey: ["launches", "live"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("launches_public")
        .select(LAUNCH_PUBLIC_COLUMNS)
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
        .from("launches_public")
        .select(LAUNCH_PUBLIC_COLUMNS)
        .eq("status", "launched")
        .order("launch_datetime", { ascending: false });
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
        .from("contributions_public")
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

  useEffect(() => {
    setCurrentPage(1);
  }, [liveLaunches?.length]);

  useEffect(() => {
    setCompletedPage(1);
  }, [completedLaunches?.length]);

  const totalPages = Math.ceil((liveLaunches?.length || 0) / LAUNCHES_PER_PAGE);
  const paginatedLaunches = liveLaunches?.slice(
    (currentPage - 1) * LAUNCHES_PER_PAGE,
    currentPage * LAUNCHES_PER_PAGE,
  ) || [];

  const totalCompletedPages = Math.ceil((completedLaunches?.length || 0) / LAUNCHES_PER_PAGE);
  const paginatedCompleted = completedLaunches?.slice(
    (completedPage - 1) * LAUNCHES_PER_PAGE,
    completedPage * LAUNCHES_PER_PAGE,
  ) || [];

  const features = [
    {
      icon: Coins,
      title: "Two Launchpads. One Presale Flow.",
      body: "Pick Bags for permanent creator-fee share or Pump for first-block entry on the bonding curve.",
    },
    {
      icon: Clock,
      title: "Apes Get Allocation, Not Promises.",
      body: "Tokens hit presaler wallets the second the bonding curve opens. No claim, no vesting, no waiting.",
    },
    {
      icon: Shield,
      title: "Non-Custodial Escrow.",
       body: "SOL sits in a per-presale escrow on Solana. No mint, no launch → automatic refund.",
    },
  ];

  return (
    <main className="min-h-screen">
      <Seo
        title="Erys — Fair-Launch Presales for Solana Tokens"
         description="Run a fair-launch presale on Bags.fm or Pump.fun. Let your community ape in early, lock in allocations on-chain, and launch on the DEX automatically."
        path="/"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Erys",
          url: "https://erys.live",
          description:
            "Fair-launch presale platform for Solana tokens on Bags.fm and Pump.fun.",
        }}
      />
      {/* Hero */}
      <section className="border-b border-border">
        <div className="container mx-auto px-4 py-5 md:py-8">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-2 inline-flex items-center gap-2 rounded-sm border border-primary/30 bg-primary/5 px-2 py-1">
              <span className="text-[10px] font-medium text-primary">PRESALES ON BAGS.FM &amp; PUMP.FUN</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">
              Run a fair-launch presale on Solana.
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
               Open a presale, schedule launch time, let your community ape in before the token launches on Bags or Pump. Allocations drop on-chain the moment it goes live.
            </p>
            <div className="mt-3 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
              <Link to="/schedule">
                <Button size="lg" className="w-full sm:w-auto">
                  Launch a Presale
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
                How presales work
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
            isMobile ? (
              <div className="flex flex-col divide-y divide-border border border-border">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <div key={i} className="h-[68px] animate-pulse bg-card" />
                ))}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-72 animate-pulse rounded-sm border border-border bg-card" />
                ))}
              </div>
            )
          ) : liveLaunches && liveLaunches.length > 0 ? (
            <>
            {isMobile ? (
              <div className="flex flex-col divide-y divide-border border border-border">
                {paginatedLaunches.map((launch, i) => {
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
                      animationDelay={Math.min(i, 10) * 30}
                      variant="row"
                    />
                  );
                })}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {paginatedLaunches.map((launch, i) => {
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
            )}
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between border border-border bg-card px-4 py-3">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ← Previous
                </button>
                <span className="font-mono text-xs text-muted-foreground">
                  Page {currentPage} of {totalPages} · {liveLaunches.length} open presales
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Next →
                </button>
              </div>
            )}
            </>
          ) : (
            <div className="mx-auto flex max-w-md flex-col items-center justify-center border border-border bg-card px-6 py-12 text-center">
              <p className="mb-6 text-muted-foreground">No presales open yet.</p>
               <Link to="/schedule">
                 <Button>Open Presale</Button>
               </Link>
            </div>
          )}
        </div>
      </section>

      {/* Completed Launches */}
      <section>
        <div className="container mx-auto px-4 py-16">
           <h2 className="mb-8 text-2xl font-bold text-foreground">Launched Tokens</h2>

          {completedLoading ? (
            isMobile ? (
              <div className="flex flex-col divide-y divide-border border border-border">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="h-[68px] animate-pulse bg-card" />
                ))}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-48 animate-pulse rounded-sm border border-border bg-card" />
                ))}
              </div>
            )
          ) : completedLaunches && completedLaunches.length > 0 ? (
            <>
            {isMobile ? (
              <div className="flex flex-col divide-y divide-border border border-border opacity-75">
                {paginatedCompleted.map((launch, i) => (
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
                    animationDelay={Math.min(i, 10) * 30}
                    variant="row"
                  />
                ))}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 opacity-75">
                {paginatedCompleted.map((launch, i) => (
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
            )}
            {totalCompletedPages > 1 && (
              <div className="mt-6 flex items-center justify-between border border-border bg-card px-4 py-3">
                <button
                  onClick={() => setCompletedPage((p) => Math.max(1, p - 1))}
                  disabled={completedPage === 1}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ← Previous
                </button>
                <span className="font-mono text-xs text-muted-foreground">
                   Page {completedPage} of {totalCompletedPages} · {completedLaunches.length} launched
                </span>
                <button
                  onClick={() => setCompletedPage((p) => Math.min(totalCompletedPages, p + 1))}
                  disabled={completedPage === totalCompletedPages}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Next →
                </button>
              </div>
            )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-sm border border-dashed border-border py-12">
               <p className="text-muted-foreground">No launched tokens yet.</p>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      {/* How it works */}
      <section id="how-it-works" className="border-t border-border">
        <div className="container mx-auto px-4 py-16">
          <h2 className="mb-8 text-2xl font-bold text-foreground">How presales work</h2>
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

    </main>
  );
};

export default Index;
