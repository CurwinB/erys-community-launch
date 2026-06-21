import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useWallet } from "@/hooks/useWallet";
import Seo from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Copy, Check, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

const LAMPORTS_PER_SOL = 1_000_000_000;
const fmtSol = (lamports: number | string | null | undefined) => {
  const n = Number(lamports ?? 0) / LAMPORTS_PER_SOL;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
};
const truncate = (s: string, n = 4) =>
  s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-n)}` : s;

type DashboardData = {
  ok: boolean;
  reason?: string;
  affiliate?: {
    id: string;
    wallet_address: string;
    referral_code: string;
    status: string;
    created_at: string;
  };
  totals?: {
    referred_wallets: number;
    attributed_launches: number;
    lifetime_lamports: number;
  };
  referred_wallets?: Array<{
    wallet_address: string;
    attributed_at: string;
    launch_count: number;
    earned_lamports: number;
  }>;
  earnings?: Array<{
    id: string;
    launch_id: string;
    token_name: string;
    token_symbol: string;
    amount_lamports: number;
    tx_signature: string | null;
    status: string;
    created_at: string;
  }>;
};

const AffiliatePage = () => {
  const { publicKey, ready } = useWallet();
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["affiliate-dashboard", publicKey],
    enabled: ready && !!publicKey,
    queryFn: async (): Promise<DashboardData> => {
      const { data, error } = await supabase.rpc(
        "affiliate_dashboard" as any,
        { p_wallet: publicKey! } as any,
      );
      if (error) throw error;
      return (data ?? { ok: false }) as DashboardData;
    },
  });

  const referralLink = useMemo(() => {
    const code = data?.affiliate?.referral_code;
    if (!code) return "";
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://erys.live";
    return `${origin}/r/${code}`;
  }, [data?.affiliate?.referral_code]);

  const chartData = useMemo(() => {
    const earnings = data?.earnings ?? [];
    const byDay = new Map<string, number>();
    for (const e of earnings) {
      const day = e.created_at.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + Number(e.amount_lamports));
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, lamports]) => ({
        day,
        sol: Number(lamports) / LAMPORTS_PER_SOL,
      }));
  }, [data?.earnings]);

  const copyLink = async () => {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    setCopied(true);
    toast.success("Referral link copied");
    setTimeout(() => setCopied(false), 1500);
  };

  if (!ready) {
    return (
      <main className="container mx-auto flex min-h-[60vh] items-center justify-center px-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!publicKey) {
    return (
      <>
        <Seo title="Affiliate · erys" description="Erys affiliate dashboard." />
        <main className="container mx-auto max-w-2xl px-4 py-16">
          <h1 className="text-2xl font-medium text-foreground">Affiliate Dashboard</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Connect your wallet to view your affiliate dashboard.
          </p>
        </main>
      </>
    );
  }

  if (isLoading) {
    return (
      <main className="container mx-auto flex min-h-[60vh] items-center justify-center px-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!data?.ok || !data.affiliate) {
    return (
      <>
        <Seo title="Affiliate · erys" description="Erys affiliate dashboard." />
        <main className="container mx-auto max-w-2xl px-4 py-16">
          <h1 className="text-2xl font-medium text-foreground">Not an affiliate</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This wallet is not enrolled in the Erys affiliate program. The program
            is admin-controlled — get in touch if you'd like to be added.
          </p>
          <Button asChild variant="outline" className="mt-6 rounded-none">
            <Link to="/">Back home</Link>
          </Button>
        </main>
      </>
    );
  }

  const totals = data.totals!;
  const isRevoked = data.affiliate.status === "revoked";

  return (
    <>
      <Seo title="Affiliate · erys" description="Your affiliate referrals and earnings." />
      <main className="container mx-auto max-w-5xl px-4 py-8 space-y-6">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-medium text-foreground">Affiliate Dashboard</h1>
            <p className="mt-1 text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Status: {isRevoked ? (
                <span className="text-destructive">Revoked (no new attributions)</span>
              ) : (
                <span className="text-primary">Active</span>
              )}
            </p>
          </div>
        </div>

        {/* Referral link */}
        <Card className="rounded-none border border-border bg-card p-4">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            Your referral link
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded-none border border-border bg-background px-3 py-2 font-mono text-sm text-foreground">
              {referralLink}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="rounded-none"
              onClick={copyLink}
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              <span className="ml-1">{copied ? "Copied" : "Copy"}</span>
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Anyone who signs up via this link permanently earns you 15% (of the
            30% Erys fee) on every launch they ever create.
          </p>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard label="Referred wallets" value={totals.referred_wallets.toString()} />
          <KpiCard label="Attributed launches" value={totals.attributed_launches.toString()} />
          <KpiCard
            label="Lifetime earnings"
            value={`${fmtSol(totals.lifetime_lamports)} SOL`}
          />
        </div>

        {/* Earnings over time */}
        {chartData.length > 0 && (
          <Card className="rounded-none border border-border bg-card p-4">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Earnings over time
            </p>
            <div className="mt-3 h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 0,
                      fontSize: 12,
                    }}
                    formatter={(v: any) => [`${v} SOL`, "Earned"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="sol"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}

        {/* Referred creators */}
        <Card className="rounded-none border border-border bg-card p-4">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
            Referred creators
          </p>
          {(data.referred_wallets?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              No one has signed up through your link yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Wallet</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Launches</TableHead>
                  <TableHead className="text-right">Earned (SOL)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.referred_wallets!.map((r) => (
                  <TableRow key={r.wallet_address}>
                    <TableCell className="font-mono text-xs">
                      {truncate(r.wallet_address, 6)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(r.attributed_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {r.launch_count}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtSol(r.earned_lamports)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        {/* Per-launch earnings */}
        <Card className="rounded-none border border-border bg-card p-4">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
            Earnings ledger
          </p>
          {(data.earnings?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No earnings recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount (SOL)</TableHead>
                  <TableHead>Tx</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.earnings!.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs">
                      <Link to={`/launch/${e.launch_id}`} className="hover:text-primary">
                        {e.token_name}{" "}
                        <span className="text-muted-foreground">${e.token_symbol}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtSol(e.amount_lamports)}
                    </TableCell>
                    <TableCell>
                      {e.tx_signature ? (
                        <a
                          href={`https://solscan.io/tx/${e.tx_signature}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          {truncate(e.tx_signature, 4)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </main>
    </>
  );
};

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="rounded-none border border-border bg-card p-4">
      <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 font-mono text-2xl text-foreground">{value}</p>
    </Card>
  );
}

export default AffiliatePage;