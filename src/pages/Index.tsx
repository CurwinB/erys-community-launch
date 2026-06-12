import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import LaunchCard from "@/components/LaunchCard";
import Seo from "@/components/Seo";
import { supabase } from "@/integrations/supabase/client";
import { LAUNCH_PUBLIC_COLUMNS } from "@/lib/constants";
import { useIsMobile } from "@/hooks/use-mobile";
import { getPreparednessTier } from "@/lib/preparedness";
import { Coins, Clock, Shield, TrendingUp, Rocket } from "lucide-react";

type SortKey = "soonest" | "contributors" | "funded";

const Index = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const [completedPage, setCompletedPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("soonest");
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

  // Fetch contribution stats for completed launches (static once launched).
  const { data: completedStats } = useQuery({
    queryKey: ["completed-contribution-stats", completedLaunches?.map((l) => l.id)],
    enabled: !!completedLaunches && completedLaunches.length > 0,
    queryFn: async () => {
      if (!completedLaunches) return {};
      const ids = completedLaunches.map((l) => l.id);
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
  const sortedLiveLaunches = (() => {
    if (!liveLaunches) return [];
    const arr = [...liveLaunches];
    if (sortKey === "soonest") {
      arr.sort(
        (a, b) =>
          new Date(a.launch_datetime).getTime() -
          new Date(b.launch_datetime).getTime(),
      );
    } else if (sortKey === "contributors") {
      arr.sort(
        (a, b) =>
          (contributionStats?.[b.id]?.count || 0) -
          (contributionStats?.[a.id]?.count || 0),
      );
    } else if (sortKey === "funded") {
      arr.sort(
        (a, b) =>
          (contributionStats?.[b.id]?.total || 0) -
          (contributionStats?.[a.id]?.total || 0),
      );
    }
    return arr;
  })();
  const paginatedLaunches = sortedLiveLaunches.slice(
    (currentPage - 1) * LAUNCHES_PER_PAGE,
    currentPage * LAUNCHES_PER_PAGE,
  );

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: "soonest", label: "Soonest" },
    { key: "contributors", label: "Top Contributors" },
    { key: "funded", label: "Most Funded" },
  ];

  const COMPLETED_LIMIT = 3;
  const totalCompletedPages = 1;
  const paginatedCompleted = completedLaunches?.slice(0, COMPLETED_LIMIT) || [];

  const features = [
    {
      icon: Coins,
      title: "Escrowed on-chain",
      body: "No one can access your SOL before launch. Not the dev. Not Erys.",
    },
    {
      icon: Clock,
      title: "Auto-refund if raise fails",
      body: "Raise doesn't hit at least 0.3 Sol? Every contributor gets their SOL back",
    },
    {
      icon: Shield,
      title: "No custody",
      body: "Erys never holds funds. Execution goes direct to Pump.fun or Bags.fm.",
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
      <section className="relative overflow-hidden border-b border-border">
        {/* Ambient glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 0%, hsl(var(--primary) / 0.15) 0%, transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, hsl(var(--primary) / 0.6), transparent)",
          }}
        />
        <div className="container mx-auto px-4 py-6 md:py-8">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mx-auto mb-4 inline-flex items-center gap-2 border border-border bg-card/60 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground backdrop-blur md:text-[11px]">
              <span className="text-primary">Bags.fm</span>
              <span className="text-border">/</span>
              <span className="text-primary">Pump.fun</span>
              <span className="text-border">·</span>
              <span>Fair-launch infrastructure</span>
            </div>
            <h1 className="text-2xl font-bold leading-[1.1] tracking-tight text-foreground md:text-2xl">
              Every multiple from{" "}
              <span className="text-primary [text-shadow:0_0_30px_hsl(var(--primary)/0.5)]">
                Block one.
              </span>
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-xs text-muted-foreground md:text-sm">
              The biggest gains in any token's life happen in the first minutes. Erys puts you in before the first minute exists so whatever the token does, you captured all of it.
            </p>
            <div className="mt-3 flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Button
                className="w-full px-6 shadow-[0_0_20px_hsl(var(--primary)/0.35)] sm:w-auto"
                onClick={() =>
                  document.getElementById("launches")?.scrollIntoView({ behavior: "smooth" })
                }
              >
                Pool into a launch
              </Button>
              <Link to="/schedule" className="w-full sm:w-auto">
                <Button variant="outline" className="w-full sm:w-auto">
                  Schedule a Launch
                </Button>
              </Link>
            </div>

            {/* Identity blocks */}
            <div className="mx-auto mt-4 grid max-w-2xl grid-cols-2 gap-2">
              <button
                onClick={() =>
                  document.getElementById("launches")?.scrollIntoView({ behavior: "smooth" })
                }
                className="group border border-border bg-card/60 px-3 py-2 text-left backdrop-blur transition-all hover:border-primary/60 hover:bg-card"
              >
                <div className="mb-0.5 flex items-center gap-1.5">
                  <TrendingUp className="h-3 w-3 text-primary" />
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground group-hover:text-primary">
                    For Traders
                  </span>
                </div>
                <p className="text-xs font-semibold text-foreground">
                  When the token doubles, triples, and beyond, you're already in.
                </p>
              </button>
              <Link
                to="/schedule"
                className="group border border-border bg-card/60 px-3 py-2 text-left backdrop-blur transition-all hover:border-primary/60 hover:bg-card"
              >
                <div className="mb-0.5 flex items-center gap-1.5">
                  <Rocket className="h-3 w-3 text-primary" />
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground group-hover:text-primary">
                    For Devs
                  </span>
                </div>
                <p className="text-xs font-semibold text-foreground">
                  Built-in shill army from block one.
                </p>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Live Launches */}
      <section id="launches" className="border-b border-border">
        <div className="container mx-auto px-4 py-16">
          {liveLaunches && liveLaunches.length > 0 && (
            <div className="mb-6 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Sort
              </span>
              {sortOptions.map((opt) => {
                const active = sortKey === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => {
                      setSortKey(opt.key);
                      setCurrentPage(1);
                    }}
                    className={`border px-2 py-1 text-xs transition-colors ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}
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
                      preparednessTier={getPreparednessTier(launch as any)}
                      category={(launch as any).category}
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
                      preparednessTier={getPreparednessTier(launch as any)}
                      category={(launch as any).category}
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
              <p className="mb-6 text-muted-foreground">No launches scheduled right now.</p>
               <Link to="/schedule">
                 <Button>Schedule Launch</Button>
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
                {paginatedCompleted.map((launch, i) => {
                  const stats = completedStats?.[launch.id];
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
                    status="launched"
                    platform={(launch.platform as "bags" | "pumpfun") || "bags"}
                    preparednessTier={getPreparednessTier(launch as any)}
                    category={(launch as any).category}
                    animationDelay={Math.min(i, 10) * 30}
                    variant="row"
                  />
                  );
                })}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 opacity-75">
                {paginatedCompleted.map((launch, i) => {
                  const stats = completedStats?.[launch.id];
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
                    status="launched"
                    platform={(launch.platform as "bags" | "pumpfun") || "bags"}
                    preparednessTier={getPreparednessTier(launch as any)}
                    category={(launch as any).category}
                    animationDelay={i * 100}
                  />
                  );
                })}
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
          <h2 className="mb-8 text-2xl font-bold text-foreground">On-chain until launch. No exceptions.</h2>
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
