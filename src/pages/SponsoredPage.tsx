import { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import Seo from "@/components/Seo";
import { Loader2, Copy, Check, AlertTriangle, ExternalLink, Twitter } from "lucide-react";
import { toast } from "sonner";

type SlotState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      slot: {
        id: string;
        launch_datetime: string | null;
        sponsor_link_expires_at: string;
        sponsored_amount_lamports: number;
      };
    }
  | {
      kind: "funding";
      launchId: string;
      tokenName: string;
      launchDatetime: string;
      wasAdjusted: boolean;
      offsetMinutes: number;
      pollAttempts: number;
    }
  | {
      kind: "success";
      launchUrl: string;
      tokenName: string;
      launchDatetime: string;
      wasAdjusted: boolean;
      offsetMinutes: number;
    };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function useCountdown(target: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);
  if (!target) return "";
  const diff = new Date(target).getTime() - now;
  if (diff <= 0) return "00:00:00";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const SponsoredPage = () => {
  const { linkToken } = useParams<{ linkToken: string }>();
  const [state, setState] = useState<SlotState>({ kind: "loading" });

  // form
  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [twitterUrl, setTwitterUrl] = useState("");
  const [telegramUrl, setTelegramUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [launchDatetime, setLaunchDatetime] = useState("");
  const [creatorDeliveryWallet, setCreatorDeliveryWallet] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const slot = state.kind === "ready" ? state.slot : null;
  const expiryCountdown = useCountdown(slot?.sponsor_link_expires_at ?? null);

  const minDateTime = useMemo(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    // datetime-local expects "YYYY-MM-DDTHH:mm" in local time.
    const tzOffsetMs = d.getTimezoneOffset() * 60 * 1000;
    return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 16);
  }, []);
  const maxDateTime = useMemo(() => {
    const d = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const tzOffsetMs = d.getTimezoneOffset() * 60 * 1000;
    return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 16);
  }, []);

  useEffect(() => {
    if (!linkToken) {
      setState({ kind: "error", message: "Invalid link." });
      return;
    }
    (async () => {
      const { data, error } = await supabase.rpc("get_sponsor_slot_by_token", {
        p_token: linkToken,
      });
      if (error) {
        setState({ kind: "error", message: error.message });
        return;
      }
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) {
        setState({ kind: "error", message: "This sponsored link does not exist." });
        return;
      }
      if (row.status === "scheduled" || row.status === "executing" || row.status === "launched") {
        setState({ kind: "error", message: "This sponsored link has already been claimed." });
        return;
      }
      if (row.status === "cancelled") {
        setState({ kind: "error", message: "This sponsored link has been cancelled or expired." });
        return;
      }
      if (new Date(row.sponsor_link_expires_at) < new Date()) {
        setState({ kind: "error", message: "This sponsored link has expired." });
        return;
      }
      setState({
        kind: "ready",
        slot: {
          id: row.id,
          launch_datetime: row.launch_datetime,
          sponsor_link_expires_at: row.sponsor_link_expires_at,
          sponsored_amount_lamports: Number(row.sponsored_amount_lamports),
        },
      });
    })();
  }, [linkToken]);

  const seedSol = useMemo(
    () => (slot ? slot.sponsored_amount_lamports / 1_000_000_000 : 0.1),
    [slot],
  );

  async function uploadImage(file: File): Promise<string> {
    const ext = file.name.split(".").pop() || "png";
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("token-images").upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) throw new Error(`Image upload failed: ${error.message}`);
    const { data } = supabase.storage.from("token-images").getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!linkToken || state.kind !== "ready") return;
    if (!tokenName.trim() || !tokenSymbol.trim()) {
      toast.error("Token name and symbol are required");
      return;
    }
    if (!launchDatetime) {
      toast.error("Pick a launch time");
      return;
    }
    const launchIso = new Date(launchDatetime).toISOString();
    const diffHours = (new Date(launchIso).getTime() - Date.now()) / (1000 * 60 * 60);
    if (diffHours < 1 || diffHours > 72) {
      toast.error("Launch time must be 1–72 hours from now");
      return;
    }
    setSubmitting(true);
    try {
      let image_url: string | undefined;
      if (imageFile) {
        image_url = await uploadImage(imageFile);
      }

      const trimmedDelivery = creatorDeliveryWallet.trim();
      if (
        trimmedDelivery &&
        (trimmedDelivery.length < 32 ||
          trimmedDelivery.length > 44 ||
          !/^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmedDelivery))
      ) {
        toast.error("Pump.fun wallet address looks invalid");
        setSubmitting(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("claim-sponsored-slot", {
        body: {
          link_token: linkToken,
          token_name: tokenName.trim(),
          token_symbol: tokenSymbol.trim(),
          description: description.trim() || undefined,
          image_url,
          twitter_url: twitterUrl.trim() || undefined,
          telegram_url: telegramUrl.trim() || undefined,
          website_url: websiteUrl.trim() || undefined,
          launch_datetime: launchIso,
          creator_delivery_wallet: trimmedDelivery || undefined,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed to claim slot");

      // Edge function only writes the DB row; the Railway executor funds the
      // escrow asynchronously. Switch to the funding state and poll until
      // the launch flips to 'scheduled' (success) or 'cancelled' (failure).
      setState({
        kind: "funding",
        launchId: data.launch_id,
        tokenName: tokenName.trim(),
        launchDatetime: data.adjusted_launch_datetime || launchIso,
        wasAdjusted: Boolean(data.was_adjusted),
        offsetMinutes: Number(data.offset_minutes ?? 0),
        pollAttempts: 0,
      });
    } catch (err: any) {
      toast.error(err.message || "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  // Poll launch status while the executor funds the sponsored escrow.
  useEffect(() => {
    if (state.kind !== "funding") return;
    const MAX_POLLS = 30; // ~60s at 2s interval
    let cancelled = false;

    const poll = async () => {
      const { data, error } = await supabase.rpc("get_launch_public", {
        p_id: state.launchId,
      });
      if (cancelled) return;
      const row: any = Array.isArray(data) ? data[0] : data;
      if (error || !row) {
        // transient — keep polling
        bump();
        return;
      }
      if (row.status === "scheduled" || row.status === "executing" || row.status === "launched") {
        const fullUrl = `${window.location.origin}/launch/${state.launchId}`;
        setState({
          kind: "success",
          launchUrl: fullUrl,
          tokenName: state.tokenName,
          launchDatetime: state.launchDatetime,
          wasAdjusted: state.wasAdjusted,
          offsetMinutes: state.offsetMinutes,
        });
        return;
      }
      if (row.status === "cancelled") {
        setState({
          kind: "error",
          message:
            "Funding the sponsored escrow failed. Please contact info@erys.live for a new link.",
        });
        return;
      }
      bump();
    };

    const bump = () => {
      if (cancelled) return;
      setState((prev) => {
        if (prev.kind !== "funding") return prev;
        if (prev.pollAttempts >= MAX_POLLS) {
          // Timed out — assume it's still working; show success card with a
          // note so the user can refresh the launch page later.
          const fullUrl = `${window.location.origin}/launch/${prev.launchId}`;
          return {
            kind: "success",
            launchUrl: fullUrl,
            tokenName: prev.tokenName,
            launchDatetime: prev.launchDatetime,
            wasAdjusted: prev.wasAdjusted,
            offsetMinutes: prev.offsetMinutes,
          };
        }
        return { ...prev, pollAttempts: prev.pollAttempts + 1 };
      });
    };

    const t = setTimeout(poll, state.pollAttempts === 0 ? 1500 : 2000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [state]);

  const copyLink = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      <Seo title="Featured Presale Slot · erys" description="Claim your sponsored presale slot" />

      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold tracking-tight">
            erys<span className="text-primary">.</span>
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-widest text-amber-400 border border-amber-500/40 bg-amber-500/10 px-2 py-1">
            Sponsored
          </span>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-2xl">
        {state.kind === "loading" && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {state.kind === "error" && (
          <Card className="rounded-none border-destructive/40 bg-card p-8 text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-destructive mb-4" />
            <h1 className="text-xl font-bold mb-2">Link unavailable</h1>
            <p className="text-muted-foreground mb-6">{state.message}</p>
            <Link to="/">
              <Button variant="outline">Back to Erys</Button>
            </Link>
          </Card>
        )}

        {state.kind === "ready" && (
          <>
            <div className="mb-8">
              <h1 className="text-3xl font-bold tracking-tight mb-3">
                You've been selected for a featured Erys presale slot.
              </h1>
              <p className="text-muted-foreground mb-6">
                Erys seeds your Pump.fun presale with{" "}
                <span className="text-primary font-semibold">{seedSol} SOL</span> at no cost to
                you. Pick your own migration time below — we'll auto-shift forward by a few
                minutes if your chosen slot is already booked.
              </p>
              <Card className="rounded-none border-border bg-card p-4">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                  Link expires in
                </div>
                <div className="font-mono text-xl text-amber-400">{expiryCountdown}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {fmtDate(state.slot.sponsor_link_expires_at)}
                </div>
              </Card>
            </div>

            <Card className="rounded-none border-border bg-card p-6">
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <Label htmlFor="token_name">Token Name *</Label>
                  <Input
                    id="token_name"
                    value={tokenName}
                    onChange={(e) => setTokenName(e.target.value)}
                    placeholder="My Token"
                    required
                    className="rounded-none mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="token_symbol">Token Symbol *</Label>
                  <Input
                    id="token_symbol"
                    value={tokenSymbol}
                    onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                    placeholder="TKN"
                    maxLength={10}
                    required
                    className="rounded-none mt-1 uppercase"
                  />
                </div>
                <div>
                  <Label htmlFor="launch_dt">Migration time (1–72h ahead) *</Label>
                  <Input
                    id="launch_dt"
                    type="datetime-local"
                    value={launchDatetime}
                    onChange={(e) => setLaunchDatetime(e.target.value)}
                    min={minDateTime}
                    max={maxDateTime}
                    required
                    className="rounded-none mt-1"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    If your chosen minute is full, we'll slide forward to the next open Pump.fun migration slot.
                  </p>
                </div>
                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="rounded-none mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="image">Token Image</Label>
                  <Input
                    id="image"
                    type="file"
                    accept="image/*"
                    onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                    className="rounded-none mt-1"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="twitter">Twitter URL</Label>
                    <Input
                      id="twitter"
                      value={twitterUrl}
                      onChange={(e) => setTwitterUrl(e.target.value)}
                      placeholder="https://x.com/..."
                      className="rounded-none mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="telegram">Telegram URL</Label>
                    <Input
                      id="telegram"
                      value={telegramUrl}
                      onChange={(e) => setTelegramUrl(e.target.value)}
                      placeholder="https://t.me/..."
                      className="rounded-none mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="website">Website</Label>
                    <Input
                      id="website"
                      value={websiteUrl}
                      onChange={(e) => setWebsiteUrl(e.target.value)}
                      placeholder="https://..."
                      className="rounded-none mt-1"
                    />
                  </div>
                </div>

                <div className="border border-primary/40 bg-card p-4 space-y-2">
                  <Label htmlFor="delivery_wallet" className="text-sm font-semibold text-foreground">
                    Pump.fun wallet (optional)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Send your allocation to a wallet you control so you can trade the second the presale migrates to Pump.fun. Leave blank to claim later via Erys.
                  </p>
                  <Input
                    id="delivery_wallet"
                    value={creatorDeliveryWallet}
                    onChange={(e) => setCreatorDeliveryWallet(e.target.value)}
                    placeholder="Enter Solana wallet address"
                    className="rounded-none mt-1 font-mono text-xs"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-none"
                  size="lg"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Setting up your presale…
                    </>
                  ) : (
                    "Claim featured presale slot"
                  )}
                </Button>
              </form>
            </Card>
          </>
        )}

        {state.kind === "funding" && (
          <Card className="rounded-none border-primary/40 bg-card p-8 text-center">
            <Loader2 className="mx-auto h-10 w-10 text-primary animate-spin mb-4" />
            <h1 className="text-2xl font-bold mb-2">Funding your presale…</h1>
            <p className="text-muted-foreground mb-2">
              We're transferring{" "}
              <span className="text-foreground font-semibold">{seedSol} SOL</span>{" "}
              from the Erys treasury to your presale escrow on Solana.
            </p>
            <p className="text-xs text-muted-foreground">
              This usually takes 5–15 seconds. Don't close this tab.
            </p>
          </Card>
        )}

        {state.kind === "success" && (
          <Card className="rounded-none border-primary/40 bg-card p-8 text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Check className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Your presale is live.</h1>
            <p className="text-muted-foreground mb-6">
              <span className="text-foreground font-semibold">{state.tokenName}</span> migrates to Pump.fun at{" "}
              <span className="text-foreground">{fmtDate(state.launchDatetime)}</span>.
            </p>
            {state.wasAdjusted && (
              <p className="text-[11px] text-amber-400 mb-6 -mt-4">
                Your chosen minute was full, so we shifted forward by{" "}
                {state.offsetMinutes} minute{state.offsetMinutes === 1 ? "" : "s"}.
              </p>
            )}

            <div className="text-left mb-6">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Share this link with your community
              </Label>
              <div className="flex gap-2 mt-2">
                <Input
                  readOnly
                  value={state.launchUrl}
                  className="rounded-none font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => copyLink(state.launchUrl)}
                  className="rounded-none"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                  `I just opened a presale on @eryslive via Pump.fun.\n\nApe in before migration and lock your allocation on-chain.\n\n${state.launchUrl}`,
                )}`}
                target="_blank"
                rel="noreferrer"
              >
                <Button className="rounded-none w-full sm:w-auto">
                  <Twitter className="h-4 w-4 mr-2" />
                  Tweet your presale
                </Button>
              </a>
              <Link to={state.launchUrl.replace(window.location.origin, "")}>
                <Button variant="outline" className="rounded-none w-full sm:w-auto">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  View presale page
                </Button>
              </Link>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
};

export default SponsoredPage;