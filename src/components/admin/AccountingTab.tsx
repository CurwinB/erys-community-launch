import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  CalendarIcon,
  ChevronDown,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ATA_RENT_LAMPORTS,
  ATA_TX_FEE_LAMPORTS,
  GAS_RESERVE_LAMPORTS,
  formatDate,
  formatSolNumber,
  lamportsToSol,
  truncate,
} from "@/lib/adminFormat";
import { exportToCsv } from "@/utils/exportCsv";
import { cn } from "@/lib/utils";

const BAGS_GAS_RESERVE = 20_000;

type LedgerType =
  | "Contribution"
  | "Token Buy"
  | "Bags Fee Claimed"
  | "Pump.fun Fee Claimed"
  | "Creator Fee Paid"
  | "Refund Issued"
  | "Gas & ATA Reserve"
  | "Processing Fee"
  | "Processing Fee Received";

const ALL_TYPES: LedgerType[] = [
  "Contribution",
  "Token Buy",
  "Bags Fee Claimed",
  "Pump.fun Fee Claimed",
  "Creator Fee Paid",
  "Refund Issued",
  "Gas & ATA Reserve",
  "Processing Fee",
  "Processing Fee Received",
];

interface Launch {
  id: string;
  token_name: string;
  token_symbol: string;
  platform: string;
  status: string;
  launch_datetime: string;
  escrow_wallet_public_key: string;
  pumpfun_fees_claimed_total: number | null;
  pumpfun_fees_last_claimed_at: string | null;
  pumpfun_launch_signature: string | null;
  processing_fee_lamports?: number | null;
  processing_fee_tx_signature?: string | null;
}

interface Contribution {
  id: string;
  launch_id: string;
  wallet_address: string;
  amount_lamports: number;
  tx_signature: string;
  refund_tx_signature: string | null;
  contributed_at: string;
}

interface PlatformFeeClaim {
  id: string;
  amount_lamports: number;
  tx_signature: string;
  claimed_at: string;
}

interface Props {
  launches: Launch[];
  contributions: Contribution[];
  claims: PlatformFeeClaim[];
}

interface LedgerEntry {
  id: string;
  date: string;
  type: LedgerType;
  description: string;
  launchId: string | null;
  tokenName: string;
  tokenSymbol: string;
  platform: string;
  wallet: string;
  amountSol: number;
  direction: "in" | "out";
  txSignature: string | null;
  estimated: boolean;
}

const TYPE_BADGE: Record<LedgerType, string> = {
  Contribution: "border-primary text-primary",
  "Token Buy": "border-purple-400 text-purple-400",
  "Bags Fee Claimed": "border-success text-success",
  "Pump.fun Fee Claimed": "border-success text-success",
  "Creator Fee Paid": "border-amber-400 text-amber-400",
  "Refund Issued": "border-destructive text-destructive",
  "Gas & ATA Reserve": "border-muted-foreground text-muted-foreground",
  "Processing Fee": "border-purple-500 text-purple-500",
  "Processing Fee Received": "border-purple-500 text-purple-500",
};

type SortKey = "date" | "type" | "amountSol" | "direction" | "platform";

const AccountingTab = ({ launches, contributions, claims }: Props) => {
  const [from, setFrom] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [to, setTo] = useState<Date>(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  });
  const [typeFilter, setTypeFilter] = useState<Set<LedgerType>>(
    new Set(ALL_TYPES),
  );
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const launchById = useMemo(() => {
    const m = new Map<string, Launch>();
    launches.forEach((l) => m.set(l.id, l));
    return m;
  }, [launches]);

  const contribsByLaunch = useMemo(() => {
    const m = new Map<string, Contribution[]>();
    contributions.forEach((c) => {
      const arr = m.get(c.launch_id) ?? [];
      arr.push(c);
      m.set(c.launch_id, arr);
    });
    return m;
  }, [contributions]);

  // Build all ledger entries
  const allEntries = useMemo<LedgerEntry[]>(() => {
    const out: LedgerEntry[] = [];

    // Contributions (Inflow)
    for (const c of contributions) {
      const l = launchById.get(c.launch_id);
      out.push({
        id: `contrib-${c.id}`,
        date: c.contributed_at,
        type: "Contribution",
        description: `Contribution to ${l?.token_symbol ?? "launch"}`,
        launchId: c.launch_id,
        tokenName: l?.token_name ?? "",
        tokenSymbol: l?.token_symbol ?? "",
        platform: l?.platform ?? "",
        wallet: c.wallet_address,
        amountSol: lamportsToSol(c.amount_lamports),
        direction: "in",
        txSignature: c.tx_signature,
        estimated: false,
      });

      // Refund (Outflow)
      if (c.refund_tx_signature) {
        out.push({
          id: `refund-${c.id}`,
          date: c.contributed_at,
          type: "Refund Issued",
          description: `Refund to contributor`,
          launchId: c.launch_id,
          tokenName: l?.token_name ?? "",
          tokenSymbol: l?.token_symbol ?? "",
          platform: l?.platform ?? "",
          wallet: c.wallet_address,
          amountSol: lamportsToSol(c.amount_lamports),
          direction: "out",
          txSignature: c.refund_tx_signature,
          estimated: false,
        });
      }
    }

    // Bags Fee Claims (Inflow)
    for (const cl of claims) {
      out.push({
        id: `bagsfee-${cl.id}`,
        date: cl.claimed_at,
        type: "Bags Fee Claimed",
        description: "Bags partner fee claimed",
        launchId: null,
        tokenName: "",
        tokenSymbol: "",
        platform: "bags",
        wallet: "Erys Platform Wallet",
        amountSol: lamportsToSol(cl.amount_lamports),
        direction: "in",
        txSignature: cl.tx_signature,
        estimated: false,
      });
    }

    // Per-launch derivations
    for (const l of launches) {
      const launchContribs = contribsByLaunch.get(l.id) ?? [];
      const nonRefunded = launchContribs.filter((c) => !c.refund_tx_signature);
      const contributorCount = nonRefunded.length;

      // Pump.fun fees
      const pumpTotal = Number(l.pumpfun_fees_claimed_total ?? 0);
      if (
        l.platform === "pumpfun" &&
        pumpTotal > 0 &&
        l.pumpfun_fees_last_claimed_at
      ) {
        out.push({
          id: `pumpfee-${l.id}`,
          date: l.pumpfun_fees_last_claimed_at,
          type: "Pump.fun Fee Claimed",
          description: `Pump.fun fee claimed (Erys 50% share)`,
          launchId: l.id,
          tokenName: l.token_name,
          tokenSymbol: l.token_symbol,
          platform: l.platform,
          wallet: "Erys Platform Wallet",
          amountSol: lamportsToSol(pumpTotal * 0.5),
          direction: "in",
          txSignature: null,
          estimated: true,
        });
        out.push({
          id: `creatorfee-${l.id}`,
          date: l.pumpfun_fees_last_claimed_at,
          type: "Creator Fee Paid",
          description: `Creator fee distributed (50% share)`,
          launchId: l.id,
          tokenName: l.token_name,
          tokenSymbol: l.token_symbol,
          platform: l.platform,
          wallet: l.escrow_wallet_public_key,
          amountSol: lamportsToSol(pumpTotal * 0.5),
          direction: "out",
          txSignature: null,
          estimated: true,
        });
      }

      // Token Buy + Gas/ATA Reserve (only on launched)
      if (l.status === "launched") {
        const gasReserve =
          l.platform === "pumpfun" ? GAS_RESERVE_LAMPORTS : BAGS_GAS_RESERVE;
        const ataReserveLamports =
          contributorCount * (ATA_RENT_LAMPORTS + ATA_TX_FEE_LAMPORTS);
        const totalContribLamports = nonRefunded.reduce(
          (s, c) => s + Number(c.amount_lamports),
          0,
        );
        const processingFeeLamports = Number(l.processing_fee_lamports ?? 0);
        const tokenBuyLamports = Math.max(
          0,
          totalContribLamports -
            ataReserveLamports -
            gasReserve -
            processingFeeLamports,
        );

        out.push({
          id: `buy-${l.id}`,
          date: l.launch_datetime,
          type: "Token Buy",
          description: `Initial token buy on ${l.platform === "pumpfun" ? "Pump.fun" : "Bags"}`,
          launchId: l.id,
          tokenName: l.token_name,
          tokenSymbol: l.token_symbol,
          platform: l.platform,
          wallet: l.escrow_wallet_public_key,
          amountSol: lamportsToSol(tokenBuyLamports),
          direction: "out",
          txSignature: l.platform === "pumpfun" ? l.pumpfun_launch_signature : null,
          estimated: !(l.platform === "pumpfun" && l.pumpfun_launch_signature),
        });

        out.push({
          id: `gas-${l.id}`,
          date: l.launch_datetime,
          type: "Gas & ATA Reserve",
          description: `Gas and ATA reserve for ${contributorCount} contributors`,
          launchId: l.id,
          tokenName: l.token_name,
          tokenSymbol: l.token_symbol,
          platform: l.platform,
          wallet: l.escrow_wallet_public_key,
          amountSol: lamportsToSol(ataReserveLamports + gasReserve),
          direction: "out",
          txSignature: null,
          estimated: true,
        });

        // Processing fee outflow + matching treasury inflow.
        // For historical rows that didn't capture the fee on-chain but
        // qualify by total contributions, mark as estimated.
        const QUALIFIES_FOR_FEE = totalContribLamports >= 300_000_000;
        const recordedFeeLamports = processingFeeLamports;
        const feeLamportsToShow =
          recordedFeeLamports > 0
            ? recordedFeeLamports
            : QUALIFIES_FOR_FEE
              ? 60_000_000
              : 0;
        if (feeLamportsToShow > 0) {
          const feeSig = l.processing_fee_tx_signature ?? null;
          const isEstimated = recordedFeeLamports === 0;
          out.push({
            id: `procfee-out-${l.id}`,
            date: l.launch_datetime,
            type: "Processing Fee",
            description: `Processing fee for ${l.token_name} launch`,
            launchId: l.id,
            tokenName: l.token_name,
            tokenSymbol: l.token_symbol,
            platform: l.platform,
            wallet: l.escrow_wallet_public_key,
            amountSol: lamportsToSol(feeLamportsToShow),
            direction: "out",
            txSignature: feeSig,
            estimated: isEstimated,
          });
          out.push({
            id: `procfee-in-${l.id}`,
            date: l.launch_datetime,
            type: "Processing Fee Received",
            description: `Processing fee received from ${l.token_name} launch`,
            launchId: l.id,
            tokenName: l.token_name,
            tokenSymbol: l.token_symbol,
            platform: l.platform,
            wallet: "Erys Platform Wallet",
            amountSol: lamportsToSol(feeLamportsToShow),
            direction: "in",
            txSignature: feeSig,
            estimated: isEstimated,
          });
        }
      }
    }

    return out;
  }, [launches, contributions, claims, launchById, contribsByLaunch]);

  // Apply filters
  const filtered = useMemo(() => {
    const fromMs = from.getTime();
    const toMs = to.getTime();
    const q = search.trim().toLowerCase();
    const out = allEntries.filter((e) => {
      const t = new Date(e.date).getTime();
      if (Number.isNaN(t) || t < fromMs || t > toMs) return false;
      if (!typeFilter.has(e.type)) return false;
      if (platformFilter !== "all" && e.platform !== platformFilter) return false;
      if (q) {
        const hay = `${e.wallet} ${e.tokenName} ${e.tokenSymbol}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    out.sort((a, b) => {
      let av: any;
      let bv: any;
      switch (sortBy) {
        case "date":
          av = new Date(a.date).getTime();
          bv = new Date(b.date).getTime();
          break;
        case "amountSol":
          av = a.amountSol;
          bv = b.amountSol;
          break;
        case "type":
          av = a.type;
          bv = b.type;
          break;
        case "direction":
          av = a.direction;
          bv = b.direction;
          break;
        case "platform":
          av = a.platform;
          bv = b.platform;
          break;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return out;
  }, [allEntries, from, to, typeFilter, platformFilter, search, sortBy, sortDir]);

  // Summary
  const summary = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;
    let bagsFees = 0;
    let pumpErysShare = 0;
    let refunded = 0;
    let inHasEst = false;
    let outHasEst = false;
    let revHasEst = false;
    let refundHasEst = false;
    for (const e of filtered) {
      if (e.direction === "in") {
        totalIn += e.amountSol;
        if (e.estimated) inHasEst = true;
      } else {
        totalOut += e.amountSol;
        if (e.estimated) outHasEst = true;
      }
      if (e.type === "Bags Fee Claimed") {
        bagsFees += e.amountSol;
      }
      if (e.type === "Pump.fun Fee Claimed") {
        pumpErysShare += e.amountSol;
        if (e.estimated) revHasEst = true;
      }
      if (e.type === "Refund Issued") {
        refunded += e.amountSol;
        if (e.estimated) refundHasEst = true;
      }
    }
    return {
      totalIn,
      totalOut,
      net: totalIn - totalOut,
      revenue: bagsFees + pumpErysShare,
      refunded,
      inHasEst,
      outHasEst,
      revHasEst,
      refundHasEst,
    };
  }, [filtered]);

  const toggleType = (t: LedgerType) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  const handleExport = () => {
    const fromStr = format(from, "yyyy-MM-dd");
    const toStr = format(to, "yyyy-MM-dd");
    const rows = filtered.map((e) => ({
      Date: new Date(e.date).toISOString(),
      Type: e.type,
      Description: e.description,
      "Launch ID": e.launchId ?? "",
      "Token Name": e.tokenName,
      "Token Symbol": e.tokenSymbol,
      Platform: e.platform,
      Wallet: e.wallet,
      "Amount SOL": e.amountSol.toFixed(4),
      Direction: e.direction === "in" ? "inflow" : "outflow",
      "TX Signature": e.txSignature ?? "",
      Estimated: e.estimated ? "true" : "false",
    }));
    exportToCsv(`erys-accounting-${fromStr}-to-${toStr}`, rows);
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="bg-card border border-border rounded-none p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            From
          </label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="rounded-none w-[180px] justify-start font-mono text-xs"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(from, "yyyy-MM-dd")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={from}
                onSelect={(d) => {
                  if (d) {
                    const nd = new Date(d);
                    nd.setHours(0, 0, 0, 0);
                    setFrom(nd);
                  }
                }}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            To
          </label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="rounded-none w-[180px] justify-start font-mono text-xs"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(to, "yyyy-MM-dd")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={to}
                onSelect={(d) => {
                  if (d) {
                    const nd = new Date(d);
                    nd.setHours(23, 59, 59, 999);
                    setTo(nd);
                  }
                }}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="rounded-none h-10"
          onClick={() => {
            // Reactive — no-op, filters apply automatically.
          }}
        >
          Apply
        </Button>

        <div className="ml-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={handleExport}
            className="rounded-none h-10"
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard
          label="Total SOL In"
          value={summary.totalIn}
          color="text-success"
          estimated={summary.inHasEst}
        />
        <SummaryCard
          label="Total SOL Out"
          value={summary.totalOut}
          color="text-destructive"
          estimated={summary.outHasEst}
        />
        <SummaryCard
          label="Net Platform Revenue"
          value={summary.revenue}
          color="text-primary"
          estimated={summary.revHasEst}
        />
        <SummaryCard
          label="Total Refunded"
          value={summary.refunded}
          color="text-amber-400"
          estimated={summary.refundHasEst}
        />
      </div>

      {/* Secondary filters */}
      <div className="flex flex-wrap items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="rounded-none">
              Types ({typeFilter.size}/{ALL_TYPES.length})
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="rounded-none">
            {ALL_TYPES.map((t) => (
              <DropdownMenuCheckboxItem
                key={t}
                checked={typeFilter.has(t)}
                onCheckedChange={() => toggleType(t)}
                onSelect={(e) => e.preventDefault()}
              >
                {t}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="w-[160px] rounded-none h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-none">
            <SelectItem value="all">All Platforms</SelectItem>
            <SelectItem value="bags">Bags</SelectItem>
            <SelectItem value="pumpfun">Pump.fun</SelectItem>
          </SelectContent>
        </Select>

        <Input
          placeholder="Search wallet or token…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-none h-9 max-w-xs"
        />

        <div className="ml-auto text-xs font-mono text-muted-foreground">
          {filtered.length} entries
        </div>
      </div>

      {/* Ledger table */}
      <div className="bg-card border border-border rounded-none overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <SortableHead
                label="Date"
                k="date"
                sortBy={sortBy}
                sortDir={sortDir}
                onClick={toggleSort}
              />
              <SortableHead
                label="Type"
                k="type"
                sortBy={sortBy}
                sortDir={sortDir}
                onClick={toggleSort}
              />
              <TableHead>Description</TableHead>
              <TableHead>Launch</TableHead>
              <TableHead>Token</TableHead>
              <SortableHead
                label="Platform"
                k="platform"
                sortBy={sortBy}
                sortDir={sortDir}
                onClick={toggleSort}
              />
              <TableHead>Wallet</TableHead>
              <SortableHead
                label="Amount (SOL)"
                k="amountSol"
                sortBy={sortBy}
                sortDir={sortDir}
                onClick={toggleSort}
                align="right"
              />
              <SortableHead
                label="Dir"
                k="direction"
                sortBy={sortBy}
                sortDir={sortDir}
                onClick={toggleSort}
              />
              <TableHead>TX</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={10}
                  className="text-center text-muted-foreground py-8 font-mono text-sm"
                >
                  No entries in this date range
                </TableCell>
              </TableRow>
            )}
            {filtered.map((e) => (
              <TableRow key={e.id} className="border-border">
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  {formatDate(e.date)}
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border rounded-none whitespace-nowrap",
                      TYPE_BADGE[e.type],
                    )}
                  >
                    {e.type}
                  </span>
                </TableCell>
                <TableCell className="text-xs">{e.description}</TableCell>
                <TableCell className="font-mono text-xs">
                  {e.launchId ? (
                    <a
                      href={`/launch/${e.launchId}`}
                      className="text-primary hover:underline"
                    >
                      {truncate(e.launchId)}
                    </a>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {e.tokenSymbol ? (
                    <span>
                      <span className="font-medium">{e.tokenSymbol}</span>
                      {e.tokenName && (
                        <span className="text-muted-foreground ml-1">
                          {e.tokenName}
                        </span>
                      )}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  {e.platform ? (
                    <span
                      className={cn(
                        "inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border rounded-none",
                        e.platform === "pumpfun"
                          ? "border-success text-success"
                          : "border-primary text-primary",
                      )}
                    >
                      {e.platform === "pumpfun" ? "Pump.fun" : "Bags"}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {e.wallet.length > 20 ? truncate(e.wallet) : e.wallet}
                </TableCell>
                <TableCell className="font-mono text-right whitespace-nowrap">
                  {formatSolNumber(e.amountSol)}
                </TableCell>
                <TableCell>
                  {e.direction === "in" ? (
                    <ArrowUp className="h-4 w-4 text-success" />
                  ) : (
                    <ArrowDown className="h-4 w-4 text-destructive" />
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {e.txSignature ? (
                    <a
                      href={`https://solscan.io/tx/${e.txSignature}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      {truncate(e.txSignature)}
                    </a>
                  ) : (
                    <span className="inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border border-amber-400 text-amber-400 rounded-none">
                      Estimated
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Sticky totals row */}
        <div className="sticky bottom-0 border-t border-border bg-card p-3 flex flex-wrap gap-6 justify-end font-mono text-xs">
          <div>
            <span className="text-muted-foreground uppercase tracking-widest mr-2">
              Inflows:
            </span>
            <span className="text-success">
              {formatSolNumber(summary.totalIn)} SOL
            </span>
          </div>
          <div>
            <span className="text-muted-foreground uppercase tracking-widest mr-2">
              Outflows:
            </span>
            <span className="text-destructive">
              {formatSolNumber(summary.totalOut)} SOL
            </span>
          </div>
          <div>
            <span className="text-muted-foreground uppercase tracking-widest mr-2">
              Net:
            </span>
            <span
              className={
                summary.net >= 0 ? "text-success" : "text-destructive"
              }
            >
              {formatSolNumber(summary.net)} SOL
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

interface SummaryCardProps {
  label: string;
  value: number;
  color: string;
  estimated: boolean;
}

const SummaryCard = ({ label, value, color, estimated }: SummaryCardProps) => (
  <div className="bg-card border border-border rounded-none p-4">
    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
      {label}
    </div>
    <div className={cn("font-mono text-2xl font-bold", color)}>
      {formatSolNumber(value)} SOL
    </div>
    {estimated && (
      <div className="text-[10px] font-mono uppercase tracking-widest text-amber-400 mt-1">
        Includes estimates
      </div>
    )}
  </div>
);

interface SortableHeadProps {
  label: string;
  k: SortKey;
  sortBy: SortKey;
  sortDir: "asc" | "desc";
  onClick: (k: SortKey) => void;
  align?: "left" | "right";
}

const SortableHead = ({
  label,
  k,
  sortBy,
  sortDir,
  onClick,
  align = "left",
}: SortableHeadProps) => (
  <TableHead className={align === "right" ? "text-right" : ""}>
    <button
      type="button"
      onClick={() => onClick(k)}
      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
    >
      {label}
      {sortBy === k && (
        <span className="text-[10px]">{sortDir === "asc" ? "▲" : "▼"}</span>
      )}
    </button>
  </TableHead>
);

export default AccountingTab;
