import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@/hooks/useWallet";
import { Copy, Check, Loader2 } from "lucide-react";

interface LightningWalletRow {
  id: string;
  slot: number;
  pubkey: string;
  status: string;
  notes: string | null;
  launch_count: number;
  last_used_at: string | null;
  created_at: string;
}

function shortPubkey(p: string): string {
  if (p.length <= 12) return p;
  return `${p.slice(0, 6)}…${p.slice(-6)}`;
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

const LightningWalletsTab = () => {
  const { publicKey } = useWallet();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [copied, setCopied] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  const [pubkey, setPubkey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Auto-seed the env wallet into the DB on first load.
  useEffect(() => {
    if (seeded) return;
    setSeeded(true);
    supabase.functions
      .invoke("seed-lightning-wallet-from-env", { body: {} })
      .then(({ data, error }) => {
        if (error) {
          console.warn("[lightning-wallets] seed call error:", error);
          return;
        }
        if ((data as any)?.seeded) {
          toast({
            title: "Seeded Railway wallet",
            description: `Slot ${(data as any).slot}`,
          });
          qc.invalidateQueries({ queryKey: ["lightning-wallets"] });
        }
      })
      .catch((err) => console.warn("[lightning-wallets] seed call failed:", err));
  }, [seeded, toast, qc]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["lightning-wallets", publicKey],
    enabled: !!publicKey,
    queryFn: async (): Promise<LightningWalletRow[]> => {
      const { data, error } = await supabase.rpc(
        "admin_list_lightning_wallets",
        { p_admin_wallet: publicKey! },
      );
      if (error) throw error;
      return (data as LightningWalletRow[]) ?? [];
    },
  });

  const onCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey) return;
    if (!pubkey.trim() || !secretKey.trim() || !apiKey.trim()) {
      toast({
        title: "Missing fields",
        description: "Public key, private key, and API key are required.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "register-lightning-wallet",
        {
          body: {
            adminWallet: publicKey,
            pubkey: pubkey.trim(),
            secretKeyBase58: secretKey.trim(),
            apiKey: apiKey.trim(),
            notes: notes.trim() || null,
          },
        },
      );
      if (error) throw error;
      const payload = data as { ok?: boolean; slot?: number; error?: string };
      if (!payload?.ok) {
        throw new Error(payload?.error ?? "Registration failed");
      }
      toast({
        title: "Wallet registered",
        description: `Slot ${payload.slot} · ${shortPubkey(pubkey.trim())}`,
      });
      setPubkey("");
      setSecretKey("");
      setApiKey("");
      setNotes("");
      await refetch();
    } catch (err: any) {
      toast({
        title: "Registration failed",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const wallets = data ?? [];

  return (
    <div className="space-y-6">
      <Card className="rounded-none border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Lightning Wallets · {wallets.length}
          </h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            disabled={isLoading}
            className="rounded-none"
          >
            {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
          </Button>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Slot</TableHead>
                <TableHead>Public Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Launches</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wallets.length === 0 && !isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No wallets registered yet. Add one below.
                  </TableCell>
                </TableRow>
              )}
              {wallets.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-mono text-xs">{w.slot}</TableCell>
                  <TableCell className="font-mono text-xs">
                    <button
                      type="button"
                      onClick={() => onCopy(w.pubkey)}
                      className="inline-flex items-center gap-1 hover:text-primary"
                      title={w.pubkey}
                    >
                      {shortPubkey(w.pubkey)}
                      {copied === w.pubkey ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        w.status === "active"
                          ? "text-primary font-mono text-xs uppercase"
                          : "text-muted-foreground font-mono text-xs uppercase"
                      }
                    >
                      {w.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {w.launch_count}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(w.last_used_at)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {w.notes ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="rounded-none border-border bg-card p-4">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-3">
          Register New Wallet
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Generate a wallet at{" "}
          <a
            href="https://pumpportal.fun/api/create-wallet"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            pumpportal.fun/api/create-wallet
          </a>
          . Save the response — PumpPortal will not show the private key or
          API key again. Then paste all three values below.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lw-pubkey" className="text-xs uppercase tracking-widest">
              Public Key
            </Label>
            <Input
              id="lw-pubkey"
              value={pubkey}
              onChange={(e) => setPubkey(e.target.value)}
              placeholder="Base58 wallet public key (44 chars)"
              className="font-mono text-xs rounded-none"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lw-secret" className="text-xs uppercase tracking-widest">
              Private Key (bs58)
            </Label>
            <Input
              id="lw-secret"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder="Base58 64-byte secret key (~88 chars)"
              className="font-mono text-xs rounded-none"
              autoComplete="off"
              type="password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lw-apikey" className="text-xs uppercase tracking-widest">
              PumpPortal API Key
            </Label>
            <Input
              id="lw-apikey"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="apiKey from /api/create-wallet response"
              className="font-mono text-xs rounded-none"
              autoComplete="off"
              type="password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lw-notes" className="text-xs uppercase tracking-widest">
              Notes (optional)
            </Label>
            <Textarea
              id="lw-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. wallet 7 of 20, generated 2026-05-05"
              className="text-xs rounded-none"
              rows={2}
              maxLength={500}
            />
          </div>
          <Button
            type="submit"
            disabled={submitting}
            className="rounded-none w-full"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Encrypting and storing…
              </>
            ) : (
              "Register Wallet"
            )}
          </Button>
        </form>
      </Card>
    </div>
  );
};

export default LightningWalletsTab;