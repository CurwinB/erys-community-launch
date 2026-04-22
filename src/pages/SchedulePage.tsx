import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import Seo from "@/components/Seo";
import { supabase } from "@/integrations/supabase/client";
import { solToLamports } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@/hooks/useWallet";
import { Upload, Copy, ExternalLink, Check } from "lucide-react";
import { DynamicWidget } from "@dynamic-labs/sdk-react-core";

const SchedulePage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { connected, publicKey } = useWallet();

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
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successData, setSuccessData] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!connected || !publicKey) {
      toast({ title: "Connect Wallet", description: "Please connect your wallet to schedule a launch.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);

    try {
      const launchDatetimeLocal = new Date(`${form.launchDate}T${form.launchTime}`);
      const diffMinutes = (launchDatetimeLocal.getTime() - Date.now()) / 60_000;
      // Minimum 10 minutes so the contribution window (which closes 5 min
      // before launch) leaves at least 5 minutes for a contribution.
      if (diffMinutes < 10) {
        toast({
          title: "Launch time too soon",
          description: "Launch must be scheduled at least 10 minutes from now (contributions close 5 min before launch).",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }
      if (diffMinutes > 72 * 60) {
        toast({
          title: "Launch time too far",
          description: "Launch must be scheduled within 72 hours from now.",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

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
      const url = `${window.location.origin}/launch/${launchId}`;
      setSuccessData({ id: launchId, url });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to schedule launch.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
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
  const tweetText = encodeURIComponent(
    `I just scheduled a community token launch on @eryslive via ${platformLabel}.\n\nGet in before it goes live and secure your early position.\n\n${successData?.url || ""}`
  );

  if (successData) {
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
            <p className="text-sm text-muted-foreground">Share this link with your community.</p>

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

        {!connected && (
          <div className="mt-6 border border-primary/30 bg-card p-6 text-center space-y-4">
            <p className="text-sm text-muted-foreground">Connect your wallet to schedule a launch.</p>
            <DynamicWidget />
          </div>
        )}

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

          <div className="border-l-2 border-primary bg-muted p-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {platform === "pumpfun"
                ? "A unique escrow wallet and token mint address are generated when you schedule. All contributor SOL is held in escrow until your token launches automatically on Pump.fun at the scheduled time."
                : "A unique escrow wallet is generated for this launch. All contributor SOL is held there until your token launches automatically on Bags.fm at the scheduled time."}
            </p>
          </div>

          <Button type="submit" className="w-full" size="lg" disabled={isSubmitting || !connected}>
            {isSubmitting ? "Scheduling..." : !connected ? "Connect Wallet to Schedule" : "Schedule Launch"}
          </Button>
        </form>
      </div>
    </main>
  );
};

export default SchedulePage;
