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
import { supabase } from "@/integrations/supabase/client";
import { solToLamports } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@/hooks/useWallet";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import {
  Upload,
  Copy,
  ExternalLink,
  Check,
  Loader2,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";

// =====================================================================
// LOCAL SIGNING TEST tab
//
// 1:1 admin clone of SchedulePage's pumpfun branch. Calls the SAME
// edge function (`create-launch-pumpfun`) and the SAME contribution
// flow (`contribute`) the public form uses, so the resulting launch
// is indistinguishable from a regular pumpfun presale: it appears on
// the homepage, accepts contributions from any wallet under all
// existing rules, and is picked up by the Railway executor when
// status flips to 'executing'. Because Railway has
// USE_LOCAL_SIGNING=true, the executor runs launchWithLocalSigning
// (no Lightning API). No new edge function and no manual trigger.
// =====================================================================

const RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL;
const connection = new Connection(RPC_URL, "confirmed");

const FEE_RESERVE_SOL = 0.01;
const MIN_CREATOR_SOL_PUMPFUN = 0.1;
const PLATFORM = "pumpfun" as const;

type Step =
  | "idle"
  | "creating"
  | "awaiting_signature"
  | "confirming"
  | "recording"
  | "success"
  | "error";

export default function LocalSigningTestTab() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { connected, publicKey, wallet } = useWallet();
  const { setShowAuthFlow } = useDynamicContext();

  const [form, setForm] = useState({
    tokenName: "",
    tokenSymbol: "",
    description: "",
    twitterUrl: "",
    telegramUrl: "",
    websiteUrl: "",
    launchDate: "",
    launchTime: "",
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
  const [adjustedNotice, setAdjustedNotice] = useState<{ from: string; to: string } | null>(null);

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

  // Live slot-availability preview
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
          body: { platform: PLATFORM, launch_datetime: requested.toISOString() },
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
  }, [form.launchDate, form.launchTime]);

  const update = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const creatorContribNum = parseFloat(form.creatorContribution);
  const maxAffordable = solBalance !== null ? Math.max(0, solBalance - FEE_RESERVE_SOL) : null;
  const minCreatorSol = MIN_CREATOR_SOL_PUMPFUN;

  let creatorContribError: string | null = null;
  if (form.creatorContribution !== "") {
    if (isNaN(creatorContribNum)) {
      creatorContribError = "Enter a valid number";
    } else if (creatorContribNum < minCreatorSol) {
      creatorContribError = `Minimum ${minCreatorSol} SOL (required by Pump.fun)`;
    } else if (maxAffordable !== null && creatorContribNum > maxAffordable) {
      creatorContribError = `Insufficient balance. Max ${maxAffordable.toFixed(4)} SOL (after ${FEE_RESERVE_SOL} SOL fee reserve)`;
    }
  }

  const isBusy = step !== "idle" && step !== "error";
  const canSubmit =
    !isBusy && (!connected || (form.creatorContribution !== "" && !creatorContribError));

  const performContribution = async (launchId: string, escrowWallet: string) => {
    if (!wallet || !isSolanaWallet(wallet) || !publicKey) {
      throw new Error("Wallet not connected");
    }
    setStep("awaiting_signature");
    const lamports = solToLamports(parseFloat(form.creatorContribution));
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
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

  const recordContribution = async (launchId: string, signature: string, lamports: number) => {
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
      toast({
        title: "Invalid seed buy",
        description: creatorContribError || "Enter your seed buy amount.",
        variant: "destructive",
      });
      return;
    }
    if (parseFloat(form.creatorContribution) < minCreatorSol) {
      toast({
        title: `Minimum ${minCreatorSol} SOL required`,
        description: `Pump.fun requires at least ${minCreatorSol} SOL as the creator's seed contribution.`,
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
          description: "Launch must be at least 10 minutes from now (presale closes 5 min before launch).",
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

      const { data, error } = await supabase.functions.invoke("create-launch-pumpfun", {
        body: {
          token_name: form.tokenName,
          token_symbol: form.tokenSymbol.toUpperCase(),
          description: form.description || null,
          image_url: imageUrl,
          twitter_url: form.twitterUrl || null,
          telegram_url: form.telegramUrl || null,
          website_url: form.websiteUrl || null,
          launch_datetime: launchDatetime,
          created_by_wallet: publicKey,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const launchId = data.launch_id;
      const escrowWallet = data.escrow_wallet;
      setPendingLaunch({ launch_id: launchId, escrow_wallet: escrowWallet });

      if (data.was_adjusted && data.original_launch_datetime && data.adjusted_launch_datetime) {
        setAdjustedNotice({
          from: data.original_launch_datetime,
          to: data.adjusted_launch_datetime,
        });
      } else {
        setAdjustedNotice(null);
      }

      await performContribution(launchId, escrowWallet);

      const url = `${window.location.origin}/launch/${launchId}`;
      setSuccessData({ id: launchId, url });
      setStep("success");
    } catch (err: any) {
      console.error("[LOCAL_SIGNING_TEST] Schedule flow error:", err);
      setErrorMsg(err.message || "Something went wrong.");
      setStep("error");
    }
  };

  const handleRetryContribution = async () => {
    if (!pendingLaunch) return;
    setErrorMsg(null);
    try {
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
      }
      await performContribution(pendingLaunch.launch_id, pendingLaunch.escrow_wallet);
      const url = `${window.location.origin}/launch/${pendingLaunch.launch_id}`;
      setSuccessData({ id: pendingLaunch.launch_id, url });
      setStep("success");
    } catch (err: any) {
      console.error("[LOCAL_SIGNING_TEST] Retry contribution failed:", err);
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

  if (step === "success" && successData) {
    return (
      <div className="border border-primary/30 bg-card p-8 text-center space-y-6 max-w-lg mx-auto">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
          <Check className="h-8 w-8 text-success" />
        </div>
        <h2 className="text-2xl font-bold text-foreground">Presale is live.</h2>
        <p className="text-xs uppercase tracking-widest text-primary font-mono">
          Pump.fun · LOCAL SIGNING (via Railway USE_LOCAL_SIGNING=true)
        </p>
        <p className="text-sm text-muted-foreground">
          Your {form.creatorContribution} SOL seed buy is in the presale escrow. The Railway
          executor will run <code className="font-mono text-xs">launchWithLocalSigning</code>{" "}
          when launch_datetime is reached.
        </p>

        {adjustedNotice && (
          <div className="rounded-sm border border-amber-500/40 bg-amber-500/10 p-3 text-left">
            <p className="text-xs leading-relaxed text-amber-600 dark:text-amber-400">
              <strong>Time adjusted:</strong> moved from{" "}
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
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={copyLink}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-success" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        <Button variant="ghost" className="w-full" onClick={() => navigate(`/launch/${successData.id}`)}>
          <ExternalLink className="h-4 w-4 mr-2" />
          View Presale Page
        </Button>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            setStep("idle");
            setSuccessData(null);
            setPendingLaunch(null);
            setAdjustedNotice(null);
            setForm({
              tokenName: "",
              tokenSymbol: "",
              description: "",
              twitterUrl: "",
              telegramUrl: "",
              websiteUrl: "",
              launchDate: "",
              launchTime: "",
              creatorContribution: "",
              creatorDeliveryWallet: "",
            });
            setImageFile(null);
            setImagePreview(null);
          }}
        >
          Create another test launch
        </Button>
      </div>
    );
  }

  const submitLabel = (() => {
    if (!connected) return "Login to Open Test Presale";
    switch (step) {
      case "creating":
        return "Creating presale…";
      case "awaiting_signature":
        return "Sign the transaction in your wallet…";
      case "confirming":
        return "Confirming on-chain…";
      case "recording":
        return "Locking your allocation…";
      default:
        return "Open Test Presale & Seed";
    }
  })();

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <div className="border border-destructive/50 bg-destructive/5 p-4 flex gap-3">
        <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-mono text-xs uppercase tracking-widest text-destructive">
            Real launch · local signing path
          </div>
          <p className="text-sm text-muted-foreground">
            This form uses the <strong>same edge function and database flow</strong> as the
            public schedule page (<code className="font-mono text-xs">create-launch-pumpfun</code>{" "}
            + <code className="font-mono text-xs">contribute</code>). The launch will appear on
            the homepage and accept contributions from any wallet under existing rules. When{" "}
            <code className="font-mono text-xs">launch_datetime</code> is reached the Railway
            executor picks it up automatically; with{" "}
            <code className="font-mono text-xs">USE_LOCAL_SIGNING=true</code> it runs{" "}
            <code className="font-mono text-xs">launchWithLocalSigning</code> (no Lightning API).
            No manual trigger from this UI.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-4 border border-border bg-card p-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Token Name</Label>
              <span className="text-[10px] text-muted-foreground">
                {form.tokenName.length}/32
              </span>
            </div>
            <Input
              maxLength={32}
              value={form.tokenName}
              onChange={(e) => update("tokenName", e.target.value)}
              placeholder="My Token"
              required
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Token Symbol</Label>
              <span className="text-[10px] text-muted-foreground">
                {form.tokenSymbol.length}/10
              </span>
            </div>
            <Input
              maxLength={10}
              value={form.tokenSymbol}
              onChange={(e) => update("tokenSymbol", e.target.value.toUpperCase())}
              placeholder="TKN"
              className="font-mono uppercase"
              required
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Description</Label>
              <span className="text-[10px] text-muted-foreground">
                {form.description.length}/1000
              </span>
            </div>
            <Textarea
              maxLength={1000}
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              placeholder="Describe your token..."
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label>Token Image</Label>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed border-border bg-background p-6 transition-colors hover:border-primary/30">
              {imagePreview ? (
                <img
                  src={imagePreview}
                  alt="Preview"
                  className="h-24 w-24 rounded-sm object-cover"
                />
              ) : (
                <>
                  <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Click or drag to upload</span>
                </>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageChange}
              />
            </label>
          </div>
        </div>

        <div className="space-y-4 border border-border bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground">Social Links (optional)</h3>
          <Input
            value={form.twitterUrl}
            onChange={(e) => update("twitterUrl", e.target.value)}
            placeholder="Twitter URL"
          />
          <Input
            value={form.telegramUrl}
            onChange={(e) => update("telegramUrl", e.target.value)}
            placeholder="Telegram URL"
          />
          <Input
            value={form.websiteUrl}
            onChange={(e) => update("websiteUrl", e.target.value)}
            placeholder="Website URL"
          />
        </div>

        <div className="space-y-4 border border-border bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground">Launch Time</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={form.launchDate}
                onChange={(e) => update("launchDate", e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Time</Label>
              <Input
                type="time"
                value={form.launchTime}
                onChange={(e) => update("launchTime", e.target.value)}
                required
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Launch must be between 10 minutes and 72 hours from now. Presale closes 5 min before
            launch. Your timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
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
                    That slot is full on Pump.fun. Your presale launches at{" "}
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
                  Slot available on Pump.fun.
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div className="space-y-2 border border-border bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground">Buy Limits</h3>
          <p className="text-xs text-muted-foreground">
            Platform-enforced minimum:{" "}
            <span className="font-mono text-foreground">0.1 SOL</span> per contributor. No
            maximum.
          </p>
        </div>

        <div className="space-y-3 border border-primary/40 bg-card p-6">
          <div>
            <Label className="text-sm font-semibold text-foreground">Your Seed Buy (SOL)</Label>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              As the creator you seed the presale with your own SOL. It goes straight to the
              non-custodial escrow.
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
            <span>Minimum {minCreatorSol} SOL (Pump.fun)</span>
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
              Send your allocation to a different wallet? (optional)
            </Label>
            <Input
              placeholder="Enter Solana wallet address"
              value={form.creatorDeliveryWallet}
              onChange={(e) => update("creatorDeliveryWallet", e.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Use your Pump.fun trading wallet to flip the second launch hits.
            </p>
          </div>
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
                    Your transaction may have already landed. Click <strong>Check status</strong>{" "}
                    — we'll verify on-chain before asking you to sign again.
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
  );
}