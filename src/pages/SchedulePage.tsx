import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { isSolanaWallet } from "@dynamic-labs/solana";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import Seo from "@/components/Seo";
import { supabase } from "@/integrations/supabase/client";
import { solToLamports, lamportsToSol } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@/hooks/useWallet";
import { Upload, Copy, ExternalLink, Check, Loader2, AlertCircle } from "lucide-react";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";

const RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL;
const connection = new Connection(RPC_URL, "confirmed");

const FEE_RESERVE_SOL = 0.01;
// Bags.fm requires the NET initialBuyLamports (after our ATA + tx-fee reserves)
// to be at least 0.2 SOL — we add a small buffer to stay above their threshold.
// Pump.fun's executor floor is only 0.01 SOL net buy, so the UI minimum here is
// a product choice (not a protocol limit) to ensure a meaningful initial buy.
const MIN_CREATOR_SOL_PUMPFUN = 0.1;
const MIN_CREATOR_SOL_BAGS = 0.21;

type Step =
  | "idle"
  | "creating"
  | "awaiting_signature"
  | "confirming"
  | "recording"
  | "success"
  | "error";

const SchedulePage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { connected, publicKey, wallet } = useWallet();
  const { setShowAuthFlow } = useDynamicContext();

  const [platform, setPlatform] = useState<"bags" | "pumpfun">("bags");
  const [form, setForm] = useState({
    tokenName: "",
    tokenSymbol: "",
    description: "",
    twitterUrl: "",
    telegramUrl: "",
    websiteUrl: "",
    launchDate: "",
    launchTime: "",
    minContribution: "",
    maxContribution: "",
    enableMaxContribution: false,
    creatorContribution: "",
    creatorDeliveryWallet: "",
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingLaunch, setPendingLaunch] = useState<{
    launch_id: string;
    escrow_wallet: string;
    last_tx_signature?: string;
  } | null>(null);
  const [successData, setSuccessData] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [slotPreview, setSlotPreview] = useState<{
    wasAdjusted: boolean;
    adjustedTime: string;
    originalTime: string;
    offsetMinutes: number;
  } | null>(null);
  const [slotChecking, setSlotChecking] = useState(false);
  const [adjustedNotice, setAdjustedNotice] = useState<{
    from: string;
    to: string;
  } | null>(null);

  // Load SOL balance on connect
  useEffect(() => {
    let cancelled = false;
    if (!connected || !publicKey) {
      setSolBalance(null);
      return;
    }
    (async () => {
      try {
        const lamports = await connection.getBalance(new PublicKey(publicKey), "confirmed");
        if (!cancelled) setSolBalance(lamports / LAMPORTS_PER_SOL);
      } catch (e) {
        console.error("Balance load failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey]);

  // Live slot-availability preview: when the user picks a date+time, ask the
  // server whether that slot is free for the chosen platform. If not, surface
  // the next available minute so the user knows what time they'll actually get.
  useEffect(() => {
    if (!form.launchDate || !form.launchTime) {
      setSlotPreview(null);
      return;
    }
    const requested = new Date(`${form.launchDate}T${form.launchTime}`);
    if (isNaN(requested.getTime())) {
      setSlotPreview(null);
      return;
    }
    const diffMinutes = (requested.getTime() - Date.now()) / 60_000;
    if (diffMinutes < 10 || diffMinutes > 72 * 60) {
      setSlotPreview(null);
      return;
    }

    let cancelled = false;
    setSlotChecking(true);
    const handle = setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke("check-launch-slot", {
          body: {
            platform,
            launch_datetime: requested.toISOString(),
          },
        });
        if (cancelled) return;
        if (error || data?.error) {
          setSlotPreview(null);
        } else {
          setSlotPreview({
            wasAdjusted: data.wasAdjusted,
            adjustedTime: data.adjustedTime,
            originalTime: data.originalTime,
            offsetMinutes: data.offsetMinutes,
          });
        }
      } catch {
        if (!cancelled) setSlotPreview(null);
      } finally {
        if (!cancelled) setSlotChecking(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [form.launchDate, form.launchTime, platform]);

  const update = (key: string, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  // Live validation for creator contribution
  const creatorContribNum = parseFloat(form.creatorContribution);
  const minContribNum = parseFloat(form.minContribution);
  const maxAffordable = solBalance !== null ? Math.max(0, solBalance - FEE_RESERVE_SOL) : null;
  const minCreatorSol = platform === "bags" ? MIN_CREATOR_SOL_BAGS : MIN_CREATOR_SOL_PUMPFUN;

  let creatorContribError: string | null = null;
  if (form.creatorContribution !== "") {
    if (isNaN(creatorContribNum)) {
      creatorContribError = "Enter a valid number";
    } else if (creatorContribNum < minCreatorSol) {
      creatorContribError = `Minimum ${minCreatorSol} SOL (required by ${platform === "bags" ? "Bags.fm" : "Pump.fun"})`;
    } else if (maxAffordable !== null && creatorContribNum > maxAffordable) {
      creatorContribError = `Insufficient balance. Max ${maxAffordable.toFixed(4)} SOL (after ${FEE_RESERVE_SOL} SOL fee reserve)`;
    } else if (!isNaN(minContribNum) && creatorContribNum < minContribNum) {
      creatorContribError = `Must be ≥ launch minimum (${minContribNum} SOL)`;
    }
  }

  const isBusy = step !== "idle" && step !== "error";
  const canSubmit =
    !isBusy &&
    (!connected || (form.creatorContribution !== "" && !creatorContribError));

  const performContribution = async (launchId: string, escrowWallet: string) => {
    if (!wallet || !isSolanaWallet(wallet) || !publicKey) {
      throw new Error("Wallet not connected");
    }

    setStep("awaiting_signature");
    const lamports = solToLamports(parseFloat(form.creatorContribution));

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(publicKey),
        toPubkey: new PublicKey(escrowWallet),
        lamports,
      })
    );
    tx.feePayer = new PublicKey(publicKey);
    tx.recentBlockhash = blockhash;

    const signer = await wallet.getSigner();
    const txResult = await signer.signAndSendTransaction(tx as any);
    const signature =
      typeof txResult === "string"
        ? txResult
        : (txResult as any)?.signature ||
          (txResult as any)?.hash ||
          JSON.stringify(txResult);

    // Persist the signature immediately so retries can verify on-chain status
    // instead of asking the user to sign and pay again.
    setPendingLaunch((prev) =>
      prev
        ? { ...prev, last_tx_signature: signature }
        : { launch_id: launchId, escrow_wallet: escrowWallet, last_tx_signature: signature }
    );

    setStep("confirming");
    await pollForConfirmation(signature);

    setStep("recording");
    await recordContribution(launchId, signature, lamports);
  };

  // Poll getSignatureStatuses every 2s for up to 60s. Resolves on confirmed/finalized,
  // throws if the tx errored, throws "timeout" if not seen in time.
  const pollForConfirmation = async (signature: string, timeoutMs = 60_000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const { value } = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const status = value[0];
      if (status) {
        if (status.err) {
          throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`);
        }
        if (
          status.confirmationStatus === "confirmed" ||
          status.confirmationStatus === "finalized"
        ) {
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(
      "Couldn't confirm in time — the network is slow. Use Retry to check on-chain status."
    );
  };

  const recordContribution = async (
    launchId: string,
    signature: string,
    lamports: number
  ) => {
    const trimmedDelivery = form.creatorDeliveryWallet.trim();
    if (trimmedDelivery !== "") {
      if (
        trimmedDelivery.length < 32 ||
        trimmedDelivery.length > 44 ||
        !/^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmedDelivery)
      ) {
        throw new Error("Token delivery wallet must be a valid Solana address.");
      }
    }
    const { data, error } = await supabase.functions.invoke("contribute", {
      body: {
        launch_id: launchId,
        wallet_address: publicKey!,
        amount_lamports: lamports,
        tx_signature: signature,
        token_delivery_wallet: trimmedDelivery || null,
      },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!connected || !publicKey) {
      setShowAuthFlow(true);
      return;
    }
    if (creatorContribError || form.creatorContribution === "") {
      toast({ title: "Invalid contribution", description: creatorContribError || "Enter your contribution amount.", variant: "destructive" });
      return;
    }

    // Hard guard: both platforms require at least 0.2 SOL initial buy
    if (parseFloat(form.creatorContribution) < minCreatorSol) {
      toast({
        title: `Minimum ${minCreatorSol} SOL required`,
        description: `${platform === "bags" ? "Bags.fm" : "Pump.fun"} requires at least ${minCreatorSol} SOL as the creator's seed contribution.`,
        variant: "destructive",
      });
      return;
    }

    setErrorMsg(null);

    try {
      const launchDatetimeLocal = new Date(`${form.launchDate}T${form.launchTime}`);
      const diffMinutes = (launchDatetimeLocal.getTime() - Date.now()) / 60_000;
      if (diffMinutes < 10) {
        toast({
          title: "Launch time too soon",
          description: "Launch must be scheduled at least 10 minutes from now (contributions close 5 min before launch).",
          variant: "destructive",
        });
        return;
      }
      if (diffMinutes > 72 * 60) {
        toast({
          title: "Launch time too far",
          description: "Launch must be scheduled within 72 hours from now.",
          variant: "destructive",
        });
        return;
      }

      setStep("creating");

      let imageUrl: string | null = null;
      if (imageFile) {
        const ext = imageFile.name.split(".").pop();
        const path = `${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("token-images")
          .upload(path, imageFile);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("token-images").getPublicUrl(path);
        imageUrl = urlData.publicUrl;
      }

      const launchDatetime = new Date(`${form.launchDate}T${form.launchTime}`).toISOString();

      const fnName = platform === "pumpfun" ? "create-launch-pumpfun" : "create-launch";
      const { data, error } = await supabase.functions.invoke(fnName, {
        body: {
          token_name: form.tokenName,
          token_symbol: form.tokenSymbol.toUpperCase(),
          description: form.description || null,
          image_url: imageUrl,
          twitter_url: form.twitterUrl || null,
          telegram_url: form.telegramUrl || null,
          website_url: form.websiteUrl || null,
          launch_datetime: launchDatetime,
          min_contribution_lamports: solToLamports(parseFloat(form.minContribution)),
          max_contribution_lamports: form.enableMaxContribution
            ? solToLamports(parseFloat(form.maxContribution))
            : null,
          created_by_wallet: publicKey,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const launchId = data.launch_id;
      const escrowWallet = data.escrow_wallet;
      setPendingLaunch({ launch_id: launchId, escrow_wallet: escrowWallet });

      // If the server moved the launch to the next available slot, surface
      // that to the user on the success screen.
      if (data.was_adjusted && data.original_launch_datetime && data.adjusted_launch_datetime) {
        setAdjustedNotice({
          from: data.original_launch_datetime,
          to: data.adjusted_launch_datetime,
        });
      } else {
        setAdjustedNotice(null);
      }

      // Now run the contribution flow
      await performContribution(launchId, escrowWallet);

      const url = `${window.location.origin}/launch/${launchId}`;
      setSuccessData({ id: launchId, url });
      setStep("success");
    } catch (err: any) {
      console.error("Schedule flow error:", err);
      setErrorMsg(err.message || "Something went wrong.");
      setStep("error");
    }
  };

  const handleRetryContribution = async () => {
    if (!pendingLaunch) return;
    setErrorMsg(null);
    try {
      // If we already sent a transaction, check whether it landed before re-signing.
      if (pendingLaunch.last_tx_signature) {
        setStep("confirming");
        const { value } = await connection.getSignatureStatuses(
          [pendingLaunch.last_tx_signature],
          { searchTransactionHistory: true }
        );
        const status = value[0];
        if (
          status &&
          !status.err &&
          (status.confirmationStatus === "confirmed" ||
            status.confirmationStatus === "finalized")
        ) {
          // Already on-chain — just record it, don't ask user to pay again.
          setStep("recording");
          const lamports = solToLamports(parseFloat(form.creatorContribution));
          await recordContribution(
            pendingLaunch.launch_id,
            pendingLaunch.last_tx_signature,
            lamports
          );
          const url = `${window.location.origin}/launch/${pendingLaunch.launch_id}`;
          setSuccessData({ id: pendingLaunch.launch_id, url });
          setStep("success");
          return;
        }
        // Status unknown or errored — fall through and send a new tx.
      }
      await performContribution(pendingLaunch.launch_id, pendingLaunch.escrow_wallet);
      const url = `${window.location.origin}/launch/${pendingLaunch.launch_id}`;
      setSuccessData({ id: pendingLaunch.launch_id, url });
      setStep("success");
    } catch (err: any) {
      console.error("Retry contribution failed:", err);
      setErrorMsg(err.message || "Contribution failed.");
      setStep("error");
    }
  };

  const copyLink = () => {
    if (successData) {
      navigator.clipboard.writeText(successData.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const platformLabel = platform === "pumpfun" ? "Pump.fun" : "Bags.fm";
  const platformTag = platform === "pumpfun" ? "@pumpfun" : "@BagsApp";
  const tweetText = encodeURIComponent(
    `I just scheduled a community token launch on @eryslive via ${platformTag}.\n\nGet in before it goes live and secure your early position.\n\n${successData?.url || ""}`
  );

  if (step === "success" && successData) {
    return (
      <main className="min-h-screen">
        <div className="container mx-auto max-w-lg px-4 py-16">
          <div className="border border-primary/30 bg-card p-8 text-center space-y-6">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
              <Check className="h-8 w-8 text-success" />
            </div>
            <h2 className="text-2xl font-bold text-foreground">Launch Scheduled!</h2>
            <p className="text-xs uppercase tracking-widest text-primary">
              Launching on {platformLabel}
            </p>
            <p className="text-sm text-muted-foreground">
              Your {form.creatorContribution} SOL seed contribution is in escrow. Share this link with your community.
            </p>

            {adjustedNotice && (
              <div className="rounded-sm border border-amber-500/40 bg-amber-500/10 p-3 text-left">
                <p className="text-xs leading-relaxed text-amber-600 dark:text-amber-400">
                  <strong>Time adjusted:</strong> the slot you picked was full,
                  so your launch was moved from{" "}
                  <strong>
                    {new Date(adjustedNotice.from).toLocaleString([], {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </strong>{" "}
                  to{" "}
                  <strong>
                    {new Date(adjustedNotice.to).toLocaleString([], {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </strong>
                  .
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 rounded-sm border border-border bg-background p-3">
              <code className="flex-1 truncate text-xs text-primary">{successData.url}</code>
              <Button variant="outline" size="icon" className="h-8 w-8 flex-shrink-0" onClick={copyLink}>
                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>

            <a
              href={`https://twitter.com/intent/tweet?text=${tweetText}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" className="w-full gap-2 mt-2">
                <ExternalLink className="h-4 w-4" />
                Share on Twitter
              </Button>
            </a>

            <Button variant="ghost" className="w-full" onClick={() => navigate(`/launch/${successData.id}`)}>
              View Launch Page
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const submitLabel = (() => {
    if (!connected) return "Log in to Schedule";
    switch (step) {
      case "creating":
        return "Creating launch…";
      case "awaiting_signature":
        return "Sign the transaction in your wallet…";
      case "confirming":
        return "Confirming on-chain…";
      case "recording":
        return "Recording contribution…";
      default:
        return "Schedule Launch & Contribute";
    }
  })();

  return (
    <main className="min-h-screen">
      <Seo
        title="Schedule a Launch — Erys"
        description="Configure your Solana token launch on Bags.fm or Pump.fun. Set the date, contribution limits, and let your community fund it before going live."
        path="/schedule"
      />
      <div className="container mx-auto max-w-xl px-4 py-12">
        <h1 className="text-2xl font-bold text-foreground md:text-3xl">Schedule a Token Launch.</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose your launch platform and let your community contribute SOL before go-live.
        </p>

        <div className="mt-6 space-y-3">
          <div className="flex gap-2 rounded-sm border border-border bg-card p-1">
            <button
              type="button"
              onClick={() => setPlatform("bags")}
              className={`flex-1 rounded-sm py-2 text-sm font-medium transition-colors ${
                platform === "bags"
                  ? "bg-primary text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Launch on Bags.fm
            </button>
            <button
              type="button"
              onClick={() => setPlatform("pumpfun")}
              className={`flex-1 rounded-sm py-2 text-sm font-medium transition-colors ${
                platform === "pumpfun"
                  ? "bg-[#00FF88] text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Launch on Pump.fun
            </button>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {platform === "bags"
              ? "Contributors earn permanent on-chain trading fee shares proportional to their contribution."
              : "Contributors receive tokens at the earliest possible entry price. Higher liquidity and trading volume."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div className="space-y-4 border border-border bg-card p-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Token Name</Label>
                <span className="text-[10px] text-muted-foreground">{form.tokenName.length}/32</span>
              </div>
              <Input maxLength={32} value={form.tokenName} onChange={(e) => update("tokenName", e.target.value)} placeholder="My Token" required />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Token Symbol</Label>
                <span className="text-[10px] text-muted-foreground">{form.tokenSymbol.length}/10</span>
              </div>
              <Input maxLength={10} value={form.tokenSymbol} onChange={(e) => update("tokenSymbol", e.target.value.toUpperCase())} placeholder="TKN" className="font-mono uppercase" required />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Description</Label>
                <span className="text-[10px] text-muted-foreground">{form.description.length}/1000</span>
              </div>
              <Textarea maxLength={1000} value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="Describe your token..." rows={4} />
            </div>

            <div className="space-y-2">
              <Label>Token Image</Label>
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed border-border bg-background p-6 transition-colors hover:border-primary/30">
                {imagePreview ? (
                  <img src={imagePreview} alt="Preview" className="h-24 w-24 rounded-sm object-cover" />
                ) : (
                  <>
                    <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Click or drag to upload</span>
                  </>
                )}
                <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
              </label>
            </div>
          </div>

          <div className="space-y-4 border border-border bg-card p-6">
            <h3 className="text-sm font-semibold text-foreground">Social Links (optional)</h3>
            <Input value={form.twitterUrl} onChange={(e) => update("twitterUrl", e.target.value)} placeholder="Twitter URL" />
            <Input value={form.telegramUrl} onChange={(e) => update("telegramUrl", e.target.value)} placeholder="Telegram URL" />
            <Input value={form.websiteUrl} onChange={(e) => update("websiteUrl", e.target.value)} placeholder="Website URL" />
          </div>

          <div className="space-y-4 border border-border bg-card p-6">
            <h3 className="text-sm font-semibold text-foreground">Launch Time</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={form.launchDate} onChange={(e) => update("launchDate", e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Time</Label>
                <Input type="time" value={form.launchTime} onChange={(e) => update("launchTime", e.target.value)} required />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Launch must be between 10 minutes and 72 hours from now. Contributions close 5 min before launch. Your timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </p>
            {form.launchDate && form.launchTime && (
              <div className="mt-2 text-xs">
                {slotChecking ? (
                  <p className="flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Checking slot availability…
                  </p>
                ) : slotPreview?.wasAdjusted ? (
                  <p className="flex items-start gap-1.5 text-amber-500">
                    <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                    <span>
                      That slot is full on {platformLabel}. Your launch will be
                      scheduled for{" "}
                      <strong>
                        {new Date(slotPreview.adjustedTime).toLocaleString([], {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </strong>{" "}
                      ({slotPreview.offsetMinutes} min later).
                    </span>
                  </p>
                ) : slotPreview ? (
                  <p className="flex items-center gap-1.5 text-success">
                    <Check className="h-3 w-3" />
                    Slot available on {platformLabel}.
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <div className="space-y-4 border border-border bg-card p-6">
            <h3 className="text-sm font-semibold text-foreground">Contribution Limits</h3>
            <div className="space-y-2">
              <Label>Minimum Contribution (SOL)</Label>
              <Input type="number" step="0.01" min="0.01" value={form.minContribution} onChange={(e) => update("minContribution", e.target.value)} placeholder="0.1" className="font-mono" required />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.enableMaxContribution} onCheckedChange={(v) => update("enableMaxContribution", v)} />
              <Label>Enable maximum contribution per wallet</Label>
            </div>
            {form.enableMaxContribution && (
              <div className="space-y-2">
                <Label>Maximum Contribution (SOL)</Label>
                <Input type="number" step="0.01" min="0.01" value={form.maxContribution} onChange={(e) => update("maxContribution", e.target.value)} placeholder="10" className="font-mono" required />
              </div>
            )}
          </div>

          <div className="space-y-3 border border-primary/40 bg-card p-6">
            <div>
              <Label className="text-sm font-semibold text-foreground">Your Contribution (SOL)</Label>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                As the creator you must contribute SOL to seed your launch. This goes directly to the escrow wallet and demonstrates commitment to your community.
              </p>
            </div>
            <Input
              type="number"
              step="0.01"
              min={minCreatorSol}
              value={form.creatorContribution}
              onChange={(e) => update("creatorContribution", e.target.value)}
              placeholder="0.1"
              className="font-mono"
              required
            />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Minimum {minCreatorSol} SOL ({platform === "bags" ? "Bags.fm" : "Pump.fun"})</span>
              {solBalance !== null && (
                <span className="font-mono">Balance: {solBalance.toFixed(4)} SOL</span>
              )}
            </div>
            {creatorContribError && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                <span>{creatorContribError}</span>
              </p>
            )}

            <div className="space-y-1 pt-2">
              <Label className="text-xs text-muted-foreground">
                Receive your tokens at a different wallet? (optional)
              </Label>
              <Input
                placeholder="Enter Solana wallet address"
                value={form.creatorDeliveryWallet}
                onChange={(e) => update("creatorDeliveryWallet", e.target.value)}
                className="font-mono text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                {platform === "pumpfun"
                  ? "Enter your Pump.fun wallet to trade immediately after launch."
                  : "Enter your Bags wallet to claim fees and trade immediately after launch."}
              </p>
            </div>
          </div>

          <div className="border-l-2 border-primary bg-muted p-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {platform === "pumpfun"
                ? "A unique escrow wallet and token mint address are generated when you schedule. Your seed SOL transfers to escrow immediately. All contributor SOL is held there until your token launches automatically on Pump.fun at the scheduled time."
                : "A unique escrow wallet is generated for this launch. Your seed SOL transfers to escrow immediately. All contributor SOL is held there until your token launches automatically on Bags.fm at the scheduled time."}
            </p>
          </div>

          {step === "error" && errorMsg && (
            <div className="space-y-3 border border-destructive/50 bg-destructive/10 p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-destructive">
                    {pendingLaunch?.last_tx_signature
                      ? "Couldn't confirm in time"
                      : pendingLaunch
                        ? "Contribution failed"
                        : "Failed to schedule"}
                  </p>
                  {pendingLaunch?.last_tx_signature && (
                    <p className="text-xs text-muted-foreground">
                      Your transaction may have already landed. Click <strong>Check status</strong> below — we'll verify on-chain before asking you to sign again.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground break-words">{errorMsg}</p>
                </div>
              </div>
              {pendingLaunch && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={handleRetryContribution}
                    disabled={isBusy}
                  >
                    {pendingLaunch.last_tx_signature ? "Check status" : "Retry contribution"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="flex-1"
                    onClick={() => navigate(`/launch/${pendingLaunch.launch_id}`)}
                  >
                    Skip and view launch
                  </Button>
                </div>
              )}
            </div>
          )}

          <Button
            type="submit"
            className="w-full gap-2"
            size="lg"
            disabled={!canSubmit || (step === "error" && !!pendingLaunch)}
          >
            {isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitLabel}
          </Button>
        </form>
      </div>
    </main>
  );
};

export default SchedulePage;
