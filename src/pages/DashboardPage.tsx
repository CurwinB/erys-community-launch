import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/StatusBadge";
import { formatSol } from "@/lib/constants";
import { Wallet, Coins, Rocket, ExternalLink } from "lucide-react";
import { useState } from "react";

type Tab = "contributions" | "launches";

const DashboardPage = () => {
  const [activeTab, setActiveTab] = useState<Tab>("contributions");
  const [isConnected] = useState(false); // Will be wired with Privy

  // Placeholder wallet — will come from Privy
  const walletAddress = "";

  const { data: myContributions } = useQuery({
    queryKey: ["my-contributions", walletAddress],
    enabled: isConnected && !!walletAddress,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contributions")
        .select("*, launches(*)")
        .eq("wallet_address", walletAddress)
        .order("contributed_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: myLaunches } = useQuery({
    queryKey: ["my-launches", walletAddress],
    enabled: isConnected && !!walletAddress,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("launches")
        .select("*")
        .eq("created_by_wallet", walletAddress)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  if (!isConnected) {
    return (
      <main className="min-h-screen">
        <div className="container mx-auto flex min-h-[60vh] flex-col items-center justify-center px-4">
          <Wallet className="mb-4 h-12 w-12 text-muted-foreground" />
          <h2 className="mb-2 text-xl font-bold text-foreground">Connect Your Wallet</h2>
          <p className="mb-6 text-sm text-muted-foreground">Connect your wallet to view your contributions and launches.</p>
          <Button className="gap-2">
            <Wallet className="h-4 w-4" />
            Connect Wallet
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <div className="container mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold text-foreground md:text-3xl">My Erys Dashboard.</h1>

        {/* Tabs */}
        <div className="mt-8 flex gap-1 border-b border-border">
          {(["contributions", "launches"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "contributions" ? "My Contributions" : "My Launches"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="mt-6">
          {activeTab === "contributions" ? (
            <div className="space-y-4">
              {/* Summary stat */}
              <div className="border border-border bg-card p-6">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Total Claimable Fees</span>
                <p className="mt-1 font-mono text-3xl font-bold text-primary">0.00 SOL</p>
                <p className="text-xs text-muted-foreground mt-1">Fee claiming will be available once Bags API is connected.</p>
              </div>

              {myContributions && myContributions.length > 0 ? (
                myContributions.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between border border-border bg-card p-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-sm bg-muted flex items-center justify-center text-sm font-bold text-muted-foreground">
                        {c.launches?.token_symbol?.charAt(0) || "?"}
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">{c.launches?.token_name || "Unknown"}</p>
                        <p className="font-mono text-xs text-muted-foreground">${c.launches?.token_symbol || "?"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="font-mono text-sm font-semibold text-foreground">{formatSol(Number(c.amount_lamports))} SOL</p>
                        <StatusBadge status={c.launches?.status || "scheduled"} />
                      </div>
                      <Button size="sm" variant="outline" disabled>
                        Claim Fees
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center rounded-sm border border-dashed border-border py-12">
                  <Coins className="mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No contributions yet.</p>
                  <Link to="/" className="mt-3">
                    <Button size="sm" variant="outline">Browse Launches</Button>
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <Link to="/schedule">
                <Button size="sm" className="gap-2">
                  <Rocket className="h-4 w-4" />
                  Schedule New Launch
                </Button>
              </Link>

              {myLaunches && myLaunches.length > 0 ? (
                myLaunches.map((l: any) => (
                  <div key={l.id} className="flex items-center justify-between border border-border bg-card p-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-sm bg-muted flex items-center justify-center text-sm font-bold text-muted-foreground">
                        {l.token_symbol.charAt(0)}
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">{l.token_name}</p>
                        <p className="font-mono text-xs text-muted-foreground">${l.token_symbol}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <StatusBadge status={l.status} />
                      <Link to={`/launch/${l.id}`}>
                        <Button size="sm" variant="outline" className="gap-1">
                          View <ExternalLink className="h-3 w-3" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center rounded-sm border border-dashed border-border py-12">
                  <Rocket className="mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No launches created yet.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
};

export default DashboardPage;
