import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Copy, Check, ExternalLink, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import StatusBadge from "@/components/StatusBadge";
import { useWallet } from "@/hooks/useWallet";

interface SponsoredLaunch {
  id: string;
  token_name: string;
  token_symbol: string;
  status: string;
  launch_datetime: string;
  created_by_wallet: string;
  sponsor_link_token: string | null;
  sponsor_link_expires_at: string | null;
  sponsor_link_claimed_at: string | null;
  is_sponsored: boolean | null;
}

interface Props {
  launches: SponsoredLaunch[];
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—";

const truncate = (s: string, n = 6) => (s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);

const SponsoredTab = ({ launches }: Props) => {
  const { publicKey: walletAddress } = useWallet();
  const queryClient = useQueryClient();

  const [influencerWallet, setInfluencerWallet] = useState("");
  const [launchDatetime, setLaunchDatetime] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState<{ link: string; expires: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const sponsored = useMemo(
    () => launches.filter((l) => l.is_sponsored).sort((a, b) =>
      new Date(b.launch_datetime).getTime() - new Date(a.launch_datetime).getTime(),
    ),
    [launches],
  );

  const minDateTime = useMemo(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  }, []);
  const maxDateTime = useMemo(() => {
    const d = new Date(Date.now() + 72 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  }, []);

  const copyText = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletAddress) {
      toast.error("Connect your admin wallet first");
      return;
    }
    if (!influencerWallet.trim() || !launchDatetime) {
      toast.error("Influencer wallet and launch time are required");
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-sponsored-slot", {
        body: {
          admin_wallet: walletAddress,
          influencer_wallet: influencerWallet.trim(),
          launch_datetime: new Date(launchDatetime).toISOString(),
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed");
      setCreatedLink({ link: data.sponsor_link, expires: data.expires_at });
      setInfluencerWallet("");
      setLaunchDatetime("");
      queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
      toast.success("Sponsored slot created");
    } catch (err: any) {
      toast.error(err.message || "Failed to create slot");
    } finally {
      setCreating(false);
    }
  };

  const handleCancel = async (launchId: string) => {
    if (!walletAddress) return;
    if (!confirm("Cancel this sponsored slot?")) return;
    try {
      const { data, error } = await supabase.functions.invoke("cancel-sponsored-slot", {
        body: { admin_wallet: walletAddress, launch_id: launchId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed");
      queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
      toast.success("Slot cancelled");
    } catch (err: any) {
      toast.error(err.message || "Failed to cancel");
    }
  };

  const buildLink = (token: string | null) =>
    token ? `${window.location.origin}/sponsored/${token}` : "";

  return (
    <div className="space-y-6">
      <Card className="rounded-none border-border bg-card p-6">
        <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-4">
          Create sponsored slot
        </h3>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="influencer">Influencer wallet address</Label>
              <Input
                id="influencer"
                value={influencerWallet}
                onChange={(e) => setInfluencerWallet(e.target.value)}
                placeholder="Solana wallet address"
                className="rounded-none mt-1 font-mono text-xs"
              />
            </div>
            <div>
              <Label htmlFor="launch_dt">Launch time (1–72h ahead)</Label>
              <Input
                id="launch_dt"
                type="datetime-local"
                min={minDateTime}
                max={maxDateTime}
                value={launchDatetime}
                onChange={(e) => setLaunchDatetime(e.target.value)}
                className="rounded-none mt-1"
              />
            </div>
          </div>
          <Button type="submit" disabled={creating} className="rounded-none">
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating…
              </>
            ) : (
              "Create sponsored slot"
            )}
          </Button>
        </form>

        {createdLink && (
          <div className="mt-6 border border-primary/40 bg-primary/5 p-4">
            <div className="text-[10px] uppercase tracking-widest text-primary mb-2">
              Sponsored slot created
            </div>
            <div className="text-xs text-muted-foreground mb-2">
              Share this link with the influencer. Expires {fmt(createdLink.expires)}.
            </div>
            <div className="flex gap-2">
              <Input
                readOnly
                value={createdLink.link}
                className="rounded-none font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="rounded-none"
                onClick={() => copyText(createdLink.link, "new")}
              >
                {copiedKey === "new" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="rounded-none border-border bg-card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Sponsored launches ({sponsored.length})
          </h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Influencer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Launch time</TableHead>
              <TableHead>Link expires</TableHead>
              <TableHead>Claimed at</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sponsored.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No sponsored slots yet
                </TableCell>
              </TableRow>
            )}
            {sponsored.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-mono text-xs">
                  {truncate(l.created_by_wallet)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={l.status as any} />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {l.token_symbol === "PENDING" ? "—" : l.token_symbol}
                </TableCell>
                <TableCell className="text-xs">{fmt(l.launch_datetime)}</TableCell>
                <TableCell className="text-xs">{fmt(l.sponsor_link_expires_at)}</TableCell>
                <TableCell className="text-xs">{fmt(l.sponsor_link_claimed_at)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {l.status === "sponsor_pending" && l.sponsor_link_token && (
                      <>
                        <Button
                          size="icon"
                          variant="outline"
                          className="rounded-none h-8 w-8"
                          onClick={() => copyText(buildLink(l.sponsor_link_token), l.id)}
                          title="Copy sponsor link"
                        >
                          {copiedKey === l.id ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="outline"
                          className="rounded-none h-8 w-8 text-destructive border-destructive/40 hover:bg-destructive/10"
                          onClick={() => handleCancel(l.id)}
                          title="Cancel slot"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    {l.status !== "sponsor_pending" && (
                      <a href={`/launch/${l.id}`} target="_blank" rel="noreferrer">
                        <Button
                          size="icon"
                          variant="outline"
                          className="rounded-none h-8 w-8"
                          title="View launch"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </a>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};

export default SponsoredTab;