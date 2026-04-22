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
        launch_datetime: string;
        sponsor_link_expires_at: string;
        sponsored_amount_lamports: number;
      };
    }
  | { kind: "success"; launchUrl: string; tokenName: string; launchDatetime: string };

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
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const slot = state.kind === "ready" ? state.slot : null;
  const launchCountdown = useCountdown(slot?.launch_datetime ?? null);
  const expiryCountdown = useCountdown(slot?.sponsor_link_expires_at ?? null);

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
    setSubmitting(true);
    try {
      let image_url: string | undefined;
      if (imageFile) {
        image_url = await uploadImage(imageFile);
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
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed to claim slot");

      const fullUrl = `${window.location.origin}${data.launch_url}`;
      setState({
        kind: "success",
        launchUrl: fullUrl,
        tokenName: tokenName.trim(),
        launchDatetime: state.slot.launch_datetime,
      });
    } catch (err: any) {
      toast.error(err.message || "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  const copyLink = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      <Seo title="Sponsored Launch · erys" description="Claim your sponsored token launch" />

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
                You have been selected for an Erys sponsored launch.
              </h1>
              <p className="text-muted-foreground mb-6">
                Erys will fund your token launch on Pump.fm with{" "}
                <span className="text-primary font-semibold">{seedSol} SOL</span> at no cost
                to you. Fill in your token details below and share your launch link with your
                community.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <Card className="rounded-none border-border bg-card p-4">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                    Launch in
                  </div>
                  <div className="font-mono text-xl text-primary">{launchCountdown}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {fmtDate(state.slot.launch_datetime)}
                  </div>
                </Card>
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

                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-none"
                  size="lg"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Setting up your launch...
                    </>
                  ) : (
                    "Claim sponsored launch"
                  )}
                </Button>
              </form>
            </Card>
          </>
        )}

        {state.kind === "success" && (
          <Card className="rounded-none border-primary/40 bg-card p-8 text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Check className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Your launch is scheduled.</h1>
            <p className="text-muted-foreground mb-6">
              <span className="text-foreground font-semibold">{state.tokenName}</span> will
              launch on Pump.fun at{" "}
              <span className="text-foreground">{fmtDate(state.launchDatetime)}</span>.
            </p>

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
                  `I just scheduled a community token launch on @eryslive via Pump.fun.\n\nGet in before it goes live and secure your early position.\n\n${state.launchUrl}`,
                )}`}
                target="_blank"
                rel="noreferrer"
              >
                <Button className="rounded-none w-full sm:w-auto">
                  <Twitter className="h-4 w-4 mr-2" />
                  Tweet your launch
                </Button>
              </a>
              <Link to={state.launchUrl.replace(window.location.origin, "")}>
                <Button variant="outline" className="rounded-none w-full sm:w-auto">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  View launch page
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