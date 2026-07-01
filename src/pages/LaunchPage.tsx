import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CountdownTimer from "@/components/CountdownTimer";
import Seo from "@/components/Seo";
import { formatSol, solToLamports, LAUNCH_PUBLIC_COLUMNS } from "@/lib/constants";
import { Wallet, Loader2, ExternalLink, Share2, Copy, Check, AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import LaunchHeader from "@/components/launch/LaunchHeader";
import LaunchStats from "@/components/launch/LaunchStats";
import ContributionFeed from "@/components/launch/ContributionFeed";
import HowItWorks from "@/components/launch/HowItWorks";
import LaunchProfile from "@/components/launch/LaunchProfile";
import CodevPanel from "@/components/launch/CodevPanel";
import SavedWalletField from "@/components/SavedWalletField";
import { saveWallet, touchSavedWallet } from "@/lib/savedWallets";

const LaunchPage = () => {
  const { id } = useParams<{ id: string }>();
  const [solAmount, setSolAmount] = useState("");
  const [tokenDeliveryWallet, setTokenDeliveryWallet] = useState("");
  const [saveDeliveryWallet, setSaveDeliveryWallet] = useState(true);
  const [deliveryWalletLabel, setDeliveryWalletLabel] = useState("");
  const [isContributing, setIsContributing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const { connected, publicKey, wallet } = useWallet();
  const { toast } = useToast();
  const { setShowAuthFlow } = useDynamicContext();
  const queryClient = useQueryClient();

  const { data: launch, isLoading } = useQuery({
    queryKey: ["launch", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("launches_public")
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
        .from("contributions_public")
        .select("id, launch_id, wallet_address, amount_lamports, contributed_at")
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

  const { data: onChainEscrowLamports } = useQuery({
    queryKey: ["escrowBalance", launch?.escrow_wallet_public_key],
    enabled: !!launch?.escrow_wallet_public_key,
    refetchInterval: 30000,
    queryFn: async () => {
      const { Connection, PublicKey } = await import("@solana/web3.js");
      const connection = new Connection(
        import.meta.env.VITE_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
        "confirmed"
      );
      const lamports = await connection.getBalance(new PublicKey(launch!.escrow_wallet_public_key));
      return lamports;
    },
  });

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

    if (sol < 0.1) {
      toast({
        title: "Below minimum buy",
        description: `Minimum ape is 0.1 SOL. You entered ${sol} SOL.`,
        variant: "destructive",
      });
      return;
    }

    if (!launch) return;

    const lamports = solToLamports(sol);

    const trimmedDelivery = tokenDeliveryWallet.trim();
    if (trimmedDelivery !== "") {
      if (
        trimmedDelivery.length < 32 ||
        trimmedDelivery.length > 44 ||
        !/^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmedDelivery)
      ) {
        toast({
          title: "Invalid wallet address",
          description: "Token delivery wallet must be a valid Solana address.",
          variant: "destructive",
        });
        return;
      }
    }

    setIsContributing(true);
    try {
      // Pre-flight validation BEFORE asking the user to sign anything.
      // Stops SOL from being stranded in escrow when validation would fail.
      const { error: validateErr } = await supabase.functions.invoke("validate-contribution", {
        body: {
          launch_id: id,
          wallet_address: publicKey,
          amount_lamports: lamports,
          token_delivery_wallet: trimmedDelivery || null,
        },
      });
      if (validateErr) {
        let serverMsg = validateErr.message || "Validation failed.";
        let status = 0;
        try {
          const ctx = (validateErr as any).context as Response | undefined;
          if (ctx) {
            status = ctx.status;
            const body = await ctx.clone().json();
            if (body?.error) serverMsg = body.error;
          }
        } catch {
          // keep default
        }
        const title =
          status === 400 || status === 422
            ? "Couldn't place ape"
            : status === 404
            ? "Launch unavailable"
            : "Ape failed";
        toast({ title, description: serverMsg, variant: "destructive" });
        return;
      }

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
          token_delivery_wallet: trimmedDelivery || null,
        },
      });

      if (error) {
        let serverMsg = error.message || "Something went wrong.";
        let status = 0;
        try {
          const ctx = (error as any).context as Response | undefined;
          if (ctx) {
            status = ctx.status;
            const body = await ctx.clone().json();
            if (body?.error) serverMsg = body.error;
          }
        } catch {
          // keep default serverMsg
        }
        const title =
          status === 400 || status === 422
            ? "Couldn't place ape"
            : status === 404
            ? "Launch unavailable"
            : status === 409
            ? "Already recorded"
            : "Ape failed";
        toast({ title, description: serverMsg, variant: "destructive" });
        queryClient.invalidateQueries({ queryKey: ["escrowBalance", launch.escrow_wallet_public_key] });
        queryClient.invalidateQueries({ queryKey: ["contributions", id] });
        return;
      }

      const tg = (launch as any)?.telegram_url?.trim?.();
      toast({
        title: "You're in.",
        description: `${sol} SOL allocation locked on-chain.`,
        ...(tg
          ? {
              action: (
                <ToastAction
                  altText="Join the Telegram"
                  onClick={() => window.open(tg, "_blank", "noopener,noreferrer")}
                >
                  Join the Telegram
                </ToastAction>
              ),
            }
          : {}),
      });
      setSolAmount("");
      setTokenDeliveryWallet("");
      const platformTag = isPumpfun ? "pumpfun" : "bags";
      if (trimmedDelivery) {
        if (saveDeliveryWallet) {
          saveWallet(publicKey, {
            address: trimmedDelivery,
            label: deliveryWalletLabel,
            platform: platformTag,
          });
        } else {
          touchSavedWallet(publicKey, trimmedDelivery);
        }
      }
      setDeliveryWalletLabel("");
      queryClient.invalidateQueries({ queryKey: ["contributions", id] });
      queryClient.invalidateQueries({ queryKey: ["escrowBalance", launch.escrow_wallet_public_key] });
    } catch (err: any) {
      console.error("Contribution error:", err);
      const raw = String(err?.message || err || "");
      let title = "Ape failed";
      let description = "Something went wrong. Please try again.";

      if (
        /denied|not allowed by the user agent|user rejected|rejected the request|user denied|NotAllowedError/i.test(raw)
      ) {
        title = "Signing cancelled";
        description = "You declined the wallet signature. Approve the passkey prompt to ape in.";
      } else if (/insufficient lamports|insufficient funds|0x1\b/i.test(raw)) {
        const match = raw.match(/insufficient lamports (\d+),\s*need (\d+)/i);
        if (match) {
          const haveSol = (Number(match[1]) / 1e9).toFixed(4);
          const needSol = (Number(match[2]) / 1e9).toFixed(4);
          description = `Your wallet has ${haveSol} SOL but needs ${needSol} SOL (plus a small network fee). Top up and try again.`;
        } else {
          description = "Your wallet doesn't have enough SOL to cover this ape plus network fees.";
        }
        title = "Not enough SOL";
      } else if (/blockhash|expired|timeout/i.test(raw)) {
        title = "Network hiccup";
        description = "The Solana network was slow to respond. Please try again.";
      }

      toast({ title, description, variant: "destructive" });
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

  const shareUrl = `${window.location.origin}/launch/${launch.id}`;
  const platformTag = isPumpfun ? "@pumpfun" : "@BagsApp";
  const tweetText = encodeURIComponent(
     `${launch.token_name} ($${launch.token_symbol}) presale is live on @eryslive via ${platformTag}.\n\nApe in before it launches and lock your allocation on-chain.\n\n${shareUrl}`
  );
  const tweetHref = `https://twitter.com/intent/tweet?text=${tweetText}`;

  const handleCopyShare = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="min-h-screen">
      <Seo
        title={`${launch.token_name} ($${launch.token_symbol}) — Erys Presale`}
        description={
          launch.description?.slice(0, 155) ||
          `Ape into the ${launch.token_name} ($${launch.token_symbol}) presale on ${isPumpfun ? "Pump.fun" : "Bags.fm"}, powered by Erys.`
        }
        path={`/launch/${launch.id}`}
        image={launch.image_url || undefined}
      />
      <LaunchHeader launch={launch} />

      <div className="container mx-auto px-4 pt-6">
        <div className="flex flex-col gap-3 border border-border bg-card p-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Share2 className="h-3.5 w-3.5" />
            <span className="text-[10px] font-semibold uppercase tracking-widest">Share</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-xs text-foreground">{shareUrl}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleCopyShare} className="gap-1.5">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <a href={tweetHref} target="_blank" rel="noopener noreferrer">
              <Button size="sm" className="gap-1.5">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                  <path d="M18.244 2H21.5l-7.5 8.57L23 22h-6.844l-5.36-7.01L4.5 22H1.244l8.03-9.18L1 2h6.99l4.84 6.4L18.244 2zm-1.2 18h1.86L7.04 4H5.07l11.974 16z" />
                </svg>
                Tweet
              </Button>
            </a>
          </div>
        </div>
      </div>

      <div className="container mx-auto grid gap-6 px-4 py-8 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <LaunchProfile
            launch={{
              profile_description:
                (launch as any).profile_description || launch.description,
              website_url: launch.website_url,
              twitter_handle: (launch as any).twitter_handle,
              meme_images: (launch as any).meme_images,
              launch_checklist: (launch as any).launch_checklist,
              launch_window: (launch as any).launch_window,
            }}
          />

          {isScheduled && (
            <div className="border border-border bg-card p-6">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Presale ends in</span>
              <CountdownTimer targetDate={launch.launch_datetime} size="lg" className="mt-3" />
            </div>
          )}

          <LaunchStats
            totalEscrow={totalEscrow}
            contributorCount={contributorCount}
            onChainLamports={onChainEscrowLamports ?? null}
          />

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

          <CodevPanel launchId={launch.id} />

          <ContributionFeed contributions={contributions || []} />
          <HowItWorks platform={launch.platform} />
        </div>

        {/* Right column - Contribution card */}
        <div className="lg:col-span-2">
          <div className="sticky top-20 space-y-4">
            {isScheduled && closingSoon && (
              <div className="border border-primary/40 bg-primary/5 p-3">
                <p className="text-xs text-primary">
                  Presale closes in less than 10 minutes.
                </p>
              </div>
            )}
            {isScheduled && windowClosed && (
              <div className="border border-border bg-muted p-3">
                <p className="text-xs text-muted-foreground">
                   Presale closed. Launching on {platformName} shortly.
                </p>
              </div>
            )}
            <div className="border border-primary/30 bg-card p-6 space-y-5">
              <h3 className="font-semibold text-foreground">Ape In</h3>

              <div className="rounded-sm border border-border bg-background p-3 space-y-2">
                <p className="text-xs font-semibold text-foreground">Your allocation includes</p>
                {isPumpfun ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="h-1.5 w-1.5 rounded-full bg-success" />
                      Pro-rata token allocation based on your buy
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="h-1.5 w-1.5 rounded-full bg-success" />
                      First-block entry on the bonding curve
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="h-1.5 w-1.5 rounded-full bg-success" />
                       Tokens dropped to your wallet at launch — no claim
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="h-1.5 w-1.5 rounded-full bg-success" />
                      Pro-rata token allocation based on your buy
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="h-1.5 w-1.5 rounded-full bg-success" />
                      Permanent on-chain creator-fee share, pro-rata to your buy
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="h-1.5 w-1.5 rounded-full bg-success" />
                       Tokens and fee position assigned at launch — no claim
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Min buy: 0.1 SOL</span>
                  {maxContrib && <span>Max buy: {formatSol(maxContrib)} SOL</span>}
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

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  Send allocation to a different wallet? (optional)
                </label>
                <SavedWalletField
                  platform={isPumpfun ? "pumpfun" : "bags"}
                  value={tokenDeliveryWallet}
                  onChange={setTokenDeliveryWallet}
                  saveEnabled={saveDeliveryWallet}
                  onSaveEnabledChange={setSaveDeliveryWallet}
                  saveLabel={deliveryWalletLabel}
                  onSaveLabelChange={setDeliveryWalletLabel}
                  disabled={!canContribute}
                  inputClassName="font-mono text-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  {isPumpfun
                     ? "Use your Pump.fun trading wallet to flip the second launch hits."
                     : "Use your Bags wallet to claim creator fees and trade immediately after launch."}
                </p>
              </div>

              <Button
                className="w-full gap-2"
                disabled={!canContribute || isContributing}
                onClick={() => {
                  if (!connected) {
                    setShowAuthFlow(true);
                    return;
                  }
                  handleContribute();
                }}
              >
                {isContributing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wallet className="h-4 w-4" />
                )}
                {!canContribute
                  ? "Presale Closed"
                  : !connected
                    ? "Connect to Ape In"
                    : isContributing
                      ? "Sending…"
                      : "Ape In"}
              </Button>

              <div className="flex items-start gap-2 border border-primary/30 bg-primary/5 p-3">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary" />
                <p className="text-[11px] leading-relaxed text-foreground">
                  Presale must reach <span className="font-mono font-semibold text-primary">0.3 SOL</span> total by launch time. If it doesn't, the launch is cancelled and all SOL is refunded automatically to contributor wallets.
                </p>
              </div>

              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {isPumpfun
                   ? "Your SOL sits in a non-custodial escrow until launch. Allocation is pro-rata at first-block entry on the bonding curve. A small platform fee covers infra."
                   : "Your SOL sits in a non-custodial escrow until launch. You receive a pro-rata token allocation AND a permanent on-chain creator-fee share."}
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
