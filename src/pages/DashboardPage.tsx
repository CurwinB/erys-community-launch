import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/StatusBadge";
import { formatSol } from "@/lib/constants";
import { Wallet, Coins, Rocket, ExternalLink, Loader2, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "@/hooks/use-toast";

type Tab = "contributions" | "launches";

interface ClaimablePosition {
  mint: string;
  claimableAmount: number;
  tokenName?: string;
  tokenSymbol?: string;
}

const DashboardPage = () => {
  const [activeTab, setActiveTab] = useState<Tab>("contributions");
  const [isConnected] = useState(false); // Will be wired with Privy
  const [claimingMint, setClaimingMint] = useState<string | null>(null);
  const queryClient = useQueryClient();

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

  // Fetch claimable positions from Bags via edge function
  const { data: claimablePositions } = useQuery({
    queryKey: ["claimable-positions", walletAddress],
    enabled: isConnected && !!walletAddress,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("claim-fees", {
        body: { action: "claimable-positions", wallet: walletAddress },
      });
      if (error) throw error;
      return (data as ClaimablePosition[]) || [];
    },
    refetchInterval: 30000, // Refresh every 30s
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

  // Calculate total claimable across all positions
  const totalClaimable = claimablePositions?.reduce(
    (sum: number, p: ClaimablePosition) => sum + (p.claimableAmount || 0),
    0
  ) || 0;

  // Get claimable amount for a specific mint
  const getClaimableForMint = (mint: string | null): number => {
    if (!mint || !claimablePositions) return 0;
    const pos = claimablePositions.find((p: ClaimablePosition) => p.mint === mint);
    return pos?.claimableAmount || 0;
  };

  // Claim fees mutation
  const claimMutation = useMutation({
    mutationFn: async (mint: string) => {
      // Step 1: Get pre-signed transaction from edge function
      const { data, error } = await supabase.functions.invoke("claim-fees", {
        body: { action: "claim", wallet: walletAddress, mint },
      });
      if (error) throw error;

      // Step 2: The transaction is pre-signed by Bags
      // Frontend must partial-sign via Privy (preserving Bags' signature)
      // then submit via the send action
      //
      // TODO: Wire with Privy's signTransaction:
      // const tx = VersionedTransaction.deserialize(Buffer.from(data.transaction, 'base64'));
      // const signedTx = await privy.signTransaction(tx); // partial sign — preserves existing sigs
      // const serialized = Buffer.from(signedTx.serialize()).toString('base64');
      //
      // Step 3: Submit the fully-signed transaction
      // const { data: sendResult, error: sendErr } = await supabase.functions.invoke("claim-fees", {
      //   body: { action: "send", transaction: serialized },
      // });

      // For now, throw until Privy is wired
      throw new Error("Privy wallet integration required for claiming. Coming soon.");
    },
    onSuccess: () => {
      toast({ title: "Fees Claimed!", description: "Your fee claim transaction was confirmed." });
      queryClient.invalidateQueries({ queryKey: ["claimable-positions"] });
      setClaimingMint(null);
    },
    onError: (err: any) => {
      toast({ title: "Claim Failed", description: err.message, variant: "destructive" });
      setClaimingMint(null);
    },
  });

  const handleClaim = (mint: string) => {
    setClaimingMint(mint);
    claimMutation.mutate(mint);
  };

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
              {/* Total Claimable Summary */}
              <div className="border border-border bg-card p-6">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Total Claimable Fees</span>
                <p className="mt-1 font-mono text-3xl font-bold text-primary">
                  {totalClaimable > 0 ? formatSol(totalClaimable) : "0.00"} SOL
                </p>
                {totalClaimable === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Claimable fees will appear here once your launched tokens generate trading volume.
                  </p>
                )}
              </div>

              {myContributions && myContributions.length > 0 ? (
                myContributions.map((c: any) => {
                  const claimable = getClaimableForMint(c.launches?.token_mint_address);
                  const isExcluded = c.is_fee_claimer === false;
                  const isClaiming = claimingMint === c.launches?.token_mint_address;
                  const isLaunched = c.launches?.status === "launched";

                  return (
                    <div key={c.id} className="border border-border bg-card p-4">
                      <div className="flex items-center justify-between">
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
                            {c.basis_points != null && (
                              <p className="text-[10px] text-muted-foreground">
                                Your share: {(c.basis_points / 100).toFixed(2)}%
                              </p>
                            )}
                            <StatusBadge status={c.launches?.status || "scheduled"} />
                          </div>
                          {isLaunched && !isExcluded && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={claimable === 0 || isClaiming}
                              onClick={() => c.launches?.token_mint_address && handleClaim(c.launches.token_mint_address)}
                              className="gap-1"
                            >
                              {isClaiming ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : null}
                              {claimable > 0 ? `Claim ${formatSol(claimable)} SOL` : "No Fees"}
                            </Button>
                          )}
                          {!isLaunched && !isExcluded && (
                            <Button size="sm" variant="outline" disabled>
                              Claim Fees
                            </Button>
                          )}
                        </div>
                      </div>
                      {isExcluded && (
                        <div className="mt-3 flex items-start gap-2 rounded-sm border border-destructive/30 bg-destructive/5 p-2.5">
                          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                          <p className="text-xs text-destructive">
                            Excluded from fee share due to 100 claimer limit. Your SOL was still used in the launch.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })
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
