import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CountdownTimer from "@/components/CountdownTimer";
import Seo from "@/components/Seo";
import { formatSol, solToLamports, LAUNCH_PUBLIC_COLUMNS } from "@/lib/constants";
import { Wallet, Loader2, ExternalLink } from "lucide-react";
import { useState, useEffect } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useToast } from "@/hooks/use-toast";
import LaunchHeader from "@/components/launch/LaunchHeader";
import LaunchStats from "@/components/launch/LaunchStats";
import ContributionFeed from "@/components/launch/ContributionFeed";
import HowItWorks from "@/components/launch/HowItWorks";

const LaunchPage = () => {
  const { id } = useParams<{ id: string }>();
  const [solAmount, setSolAmount] = useState("");
  const [isContributing, setIsContributing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const { connected, publicKey, wallet } = useWallet();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: launch, isLoading } = useQuery({
    queryKey: ["launch", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("launches")
        .select(LAUNCH_PUBLIC_COLUMNS)
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

  useEffect(() => {
    if (!launch?.launch_datetime) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [launch?.launch_datetime]);

  const totalEscrow = contributions?.reduce((sum, c) => sum + Number(c.amount_lamports), 0) || 0;
  const contributorCount = contributions?.length || 0;

  const handleContribute = async () => {
    if (!connected || !publicKey || !wallet) {
      toast({ title: "Connect Wallet", description: "Please connect your wallet first.", variant: "destructive" });
      return;
    }

    const sol = parseFloat(solAmount);
    if (!sol || sol <= 0) {
      toast({ title: "Invalid amount", description: "Enter a valid SOL amount.", variant: "destructive" });
      return;
    }

    if (!launch) return;

    const lamports = solToLamports(sol);

    setIsContributing(true);
    try {
      const { Connection, PublicKey, SystemProgram, Transaction } = await import("@solana/web3.js");

      const connection = new Connection(import.meta.env.VITE_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(publicKey),
          toPubkey: new PublicKey(launch.escrow_wallet_public_key),
          lamports,
        })
      );

      tx.feePayer = new PublicKey(publicKey);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;

      // Sign and send via Dynamic Solana signer
      const signer = await wallet.getSigner();
      const txSignature = await signer.signAndSendTransaction(tx as any);

      // Call contribute edge function to verify and record
      const { error } = await supabase.functions.invoke("contribute", {
        body: {
          launch_id: id,
          wallet_address: publicKey,
          amount_lamports: lamports,
          tx_signature: typeof txSignature === "string" ? txSignature : (txSignature as any).signature || txSignature,
        },
      });

      if (error) throw error;

      toast({ title: "Contribution Recorded!", description: `${sol} SOL contributed successfully.` });
      setSolAmount("");
      queryClient.invalidateQueries({ queryKey: ["contributions", id] });
    } catch (err: any) {
      console.error("Contribution error:", err);
      toast({ title: "Contribution Failed", description: err.message || "Something went wrong.", variant: "destructive" });
    } finally {
      setIsContributing(false);
    }
  };

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
  const isScheduled = launch.status === "scheduled";
  const launchMs = new Date(launch.launch_datetime).getTime();
  const isPastLaunchTime = now >= launchMs;
  const windowClosed = now >= launchMs - 5 * 60 * 1000;
  const closingSoon = !windowClosed && now >= launchMs - 10 * 60 * 1000;
  const canContribute = isScheduled && !isPastLaunchTime && !windowClosed;
  const isPumpfun = launch.platform === "pumpfun";
  const tradeUrl = isPumpfun
    ? `https://pump.fun/${launch.token_mint_address}`
    : `https://bags.fm/token/${launch.token_mint_address}`;
  const platformName = isPumpfun ? "Pump.fun" : "Bags.fm";
  const platformHref = isPumpfun ? "https://pump.fun" : "https://bags.fm";

  return (
    <main className="min-h-screen">
      <Seo
        title={`${launch.token_name} ($${launch.token_symbol}) — Erys Launch`}
        description={
          launch.description?.slice(0, 155) ||
          `Contribute to the ${launch.token_name} ($${launch.token_symbol}) community launch on ${isPumpfun ? "Pump.fun" : "Bags.fm"}, powered by Erys.`
        }
        path={`/launch/${launch.id}`}
        image={launch.image_url || undefined}
      />
      <LaunchHeader launch={launch} />

      <div className="container mx-auto grid gap-6 px-4 py-8 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          {isScheduled && (
            <div className="border border-border bg-card p-6">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Launches in</span>
              <CountdownTimer targetDate={launch.launch_datetime} size="lg" className="mt-3" />
            </div>
          )}

          <LaunchStats totalEscrow={totalEscrow} contributorCount={contributorCount} />

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

          <ContributionFeed contributions={contributions || []} />
          <HowItWorks />
        </div>

        {/* Right column - Contribution card */}
        <div className="lg:col-span-2">
          <div className="sticky top-20 space-y-4">
            {isScheduled && closingSoon && (
              <div className="border border-primary/40 bg-primary/5 p-3">
                <p className="text-xs text-primary">
                  Contribution window closes in less than 10 minutes.
                </p>
              </div>
            )}
            {isScheduled && windowClosed && (
              <div className="border border-border bg-muted p-3">
                <p className="text-xs text-muted-foreground">
                  Contribution window closed. Launch executes shortly.
                </p>
              </div>
            )}
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
                    disabled={!canContribute}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">SOL</span>
                </div>
              </div>

              <Button
                className="w-full gap-2"
                disabled={!canContribute || isContributing}
                onClick={handleContribute}
              >
                {isContributing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wallet className="h-4 w-4" />
                )}
                {!canContribute
                  ? "Contributions Closed"
                  : !connected
                    ? "Connect Wallet to Contribute"
                    : isContributing
                      ? "Sending..."
                      : "Contribute SOL"}
              </Button>

              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {isPumpfun
                  ? "Your SOL is held in escrow until launch. You will receive tokens at the earliest possible entry price proportional to your contribution. If this launch is cancelled your SOL is refunded automatically."
                  : "Your SOL is held in escrow until launch. You will be registered as a permanent Bags fee share recipient proportional to your contribution. If this launch is cancelled your SOL is refunded automatically."}
              </p>
            </div>

            {launch.status === "launched" && launch.token_mint_address && (
              <a
                href={tradeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <div className="flex items-center justify-center gap-2 border border-primary/30 bg-card p-3">
                  <span className="text-sm font-semibold text-primary">Trade on {platformName}</span>
                  <ExternalLink className="h-3.5 w-3.5 text-primary" />
                </div>
              </a>
            )}

            <div className="flex items-center justify-center gap-2 border border-border bg-card p-3">
              <span className="text-[10px] text-muted-foreground">This token will be launched on</span>
              <a href={platformHref} target="_blank" rel="noopener noreferrer" className="text-[10px] font-semibold text-foreground hover:text-primary transition-colors">
                {platformName}
              </a>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};

export default LaunchPage;
