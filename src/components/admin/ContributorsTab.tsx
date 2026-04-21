import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, Search } from "lucide-react";
import {
  formatSol,
  truncate,
  formatDate,
  formatPercent,
  formatInt,
  lamportsToSol,
} from "@/lib/adminFormat";
import { exportToCsv } from "@/utils/exportCsv";
import PlatformBadge from "./PlatformBadge";

interface Contribution {
  id: string;
  launch_id: string;
  wallet_address: string;
  amount_lamports: number;
  basis_points: number | null;
  token_amount: number | null;
  tokens_distributed: boolean | null;
  is_fee_claimer: boolean | null;
  contributed_at: string;
  refund_tx_signature: string | null;
}

interface Launch {
  id: string;
  token_name: string;
  token_symbol: string;
  platform: string;
}

interface Props {
  contributions: Contribution[];
  launches: Launch[];
}

const ContributorsTab = ({ contributions, launches }: Props) => {
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const launchMap = useMemo(() => {
    const m = new Map<string, Launch>();
    launches.forEach((l) => m.set(l.id, l));
    return m;
  }, [launches]);

  const filtered = useMemo(() => {
    return contributions
      .filter((c) => !c.refund_tx_signature)
      .filter((c) => {
        const launch = launchMap.get(c.launch_id);
        if (!launch) return false;
        if (platformFilter !== "all" && launch.platform !== platformFilter)
          return false;
        if (statusFilter === "distributed" && !c.tokens_distributed)
          return false;
        if (statusFilter === "pending" && c.tokens_distributed) return false;
        if (
          search &&
          !c.wallet_address.toLowerCase().includes(search.toLowerCase())
        )
          return false;
        return true;
      });
  }, [contributions, launchMap, platformFilter, statusFilter, search]);

  const handleExport = () => {
    const csvRows = filtered.map((c) => {
      const l = launchMap.get(c.launch_id);
      return {
        wallet: c.wallet_address,
        launch_id: c.launch_id,
        token: l?.token_symbol ?? "",
        platform: l?.platform ?? "",
        sol_contributed: lamportsToSol(c.amount_lamports).toFixed(4),
        share_pct: c.basis_points != null ? (c.basis_points / 100).toFixed(2) : "",
        tokens_received: c.tokens_distributed ? c.token_amount ?? "" : "",
        tokens_distributed: c.tokens_distributed ? "yes" : "no",
        fee_claimed:
          l?.platform === "pumpfun" ? "N/A" : c.is_fee_claimer ? "yes" : "no",
        contribution_date: c.contributed_at,
      };
    });
    exportToCsv("erys-contributors", csvRows);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex flex-col sm:flex-row gap-2">
          <Select value={platformFilter} onValueChange={setPlatformFilter}>
            <SelectTrigger className="w-full sm:w-40 rounded-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none">
              <SelectItem value="all">All Platforms</SelectItem>
              <SelectItem value="bags">Bags</SelectItem>
              <SelectItem value="pumpfun">Pump.fun</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-40 rounded-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none">
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="distributed">Distributed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search wallet..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 w-full sm:w-64 rounded-none font-mono text-xs"
            />
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleExport}
          className="rounded-none"
        >
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      <div className="bg-card border border-border rounded-none overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>Wallet</TableHead>
              <TableHead>Launch</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead className="text-right">SOL Contributed</TableHead>
              <TableHead className="text-right">Share %</TableHead>
              <TableHead className="text-right">Tokens Received</TableHead>
              <TableHead>Distributed</TableHead>
              <TableHead>Fee Claimed</TableHead>
              <TableHead>Contribution Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={10}
                  className="text-center text-muted-foreground py-8 font-mono text-sm"
                >
                  No contributors match filters
                </TableCell>
              </TableRow>
            )}
            {filtered.map((c) => {
              const l = launchMap.get(c.launch_id);
              const isPump = l?.platform === "pumpfun";
              return (
                <TableRow key={c.id} className="border-border">
                  <TableCell className="font-mono text-xs">
                    {truncate(c.wallet_address)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {truncate(c.launch_id, 6, 4)}
                  </TableCell>
                  <TableCell className="font-medium">
                    {l?.token_symbol ?? "—"}
                  </TableCell>
                  <TableCell>
                    {l && <PlatformBadge platform={l.platform} />}
                  </TableCell>
                  <TableCell className="font-mono text-right">
                    {formatSol(c.amount_lamports)}
                  </TableCell>
                  <TableCell className="font-mono text-right">
                    {formatPercent(c.basis_points)}
                  </TableCell>
                  <TableCell className="font-mono text-right">
                    {c.tokens_distributed && c.token_amount
                      ? formatInt(c.token_amount)
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {c.tokens_distributed ? (
                      <span className="text-success font-mono text-xs">✓</span>
                    ) : (
                      <span className="text-muted-foreground font-mono text-xs">
                        —
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {isPump ? (
                      <span className="font-mono text-xs text-muted-foreground">
                        N/A
                      </span>
                    ) : c.is_fee_claimer ? (
                      <span className="text-success font-mono text-xs">✓</span>
                    ) : (
                      <span className="text-muted-foreground font-mono text-xs">
                        —
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatDate(c.contributed_at)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default ContributorsTab;