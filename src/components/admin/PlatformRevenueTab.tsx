import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download } from "lucide-react";
import {
  formatSol,
  formatSolNumber,
  truncate,
  formatDate,
  lamportsToSol,
} from "@/lib/adminFormat";
import { exportToCsv } from "@/utils/exportCsv";

interface PlatformFeeClaim {
  id: string;
  amount_lamports: number;
  tx_signature: string;
  claimed_at: string;
}

interface Launch {
  id: string;
  token_symbol: string;
  platform: string;
  launch_datetime: string;
  pumpfun_fees_claimed_total: number | null;
  pumpfun_fees_last_claimed_at: string | null;
}

interface Props {
  bagsClaims: PlatformFeeClaim[];
  launches: Launch[];
}

const PlatformRevenueTab = ({ bagsClaims, launches }: Props) => {
  const bagsTotalSol = useMemo(
    () =>
      lamportsToSol(
        bagsClaims.reduce((sum, c) => sum + Number(c.amount_lamports), 0),
      ),
    [bagsClaims],
  );

  const pumpRows = useMemo(
    () =>
      launches
        .filter(
          (l) =>
            l.platform === "pumpfun" &&
            Number(l.pumpfun_fees_claimed_total ?? 0) > 0,
        )
        .sort(
          (a, b) =>
            new Date(b.launch_datetime).getTime() -
            new Date(a.launch_datetime).getTime(),
        ),
    [launches],
  );

  const pumpTotalErysSol = useMemo(
    () =>
      pumpRows.reduce(
        (sum, l) =>
          sum + lamportsToSol(Number(l.pumpfun_fees_claimed_total ?? 0) * 0.5),
        0,
      ),
    [pumpRows],
  );

  const combinedTotal = bagsTotalSol + pumpTotalErysSol;

  const handleExport = () => {
    const bagsRows = bagsClaims.map((c) => ({
      platform: "bags",
      claimed_at: c.claimed_at,
      amount_sol: lamportsToSol(c.amount_lamports).toFixed(4),
      tx_signature: c.tx_signature,
      token: "",
      erys_share_sol: lamportsToSol(c.amount_lamports).toFixed(4),
      creator_share_sol: "",
    }));
    const pumpExportRows = pumpRows.map((l) => {
      const total = Number(l.pumpfun_fees_claimed_total ?? 0);
      return {
        platform: "pumpfun",
        claimed_at: l.pumpfun_fees_last_claimed_at ?? "",
        amount_sol: lamportsToSol(total).toFixed(4),
        tx_signature: "",
        token: l.token_symbol,
        erys_share_sol: lamportsToSol(total * 0.5).toFixed(4),
        creator_share_sol: lamportsToSol(total * 0.5).toFixed(4),
      };
    });
    exportToCsv("erys-platform-revenue", [...bagsRows, ...pumpExportRows]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="bg-card border border-primary/40 rounded-none p-4 flex-1 mr-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
            Combined Total Revenue
          </div>
          <div className="font-mono text-3xl font-bold text-primary">
            {formatSolNumber(combinedTotal)} SOL
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Bags */}
        <div className="bg-card border border-border rounded-none">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Bags Revenue
              </div>
              <div className="font-mono text-xl font-bold text-primary">
                {formatSolNumber(bagsTotalSol)} SOL
              </div>
            </div>
            <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border border-primary text-primary rounded-none">
              Bags
            </span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead>Claimed At</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>TX</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bagsClaims.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="text-center text-muted-foreground py-6 font-mono text-sm"
                    >
                      No claims yet
                    </TableCell>
                  </TableRow>
                )}
                {bagsClaims.map((c) => (
                  <TableRow key={c.id} className="border-border">
                    <TableCell className="font-mono text-xs">
                      {formatDate(c.claimed_at)}
                    </TableCell>
                    <TableCell className="font-mono text-right">
                      {formatSol(c.amount_lamports)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <a
                        href={`https://solscan.io/tx/${c.tx_signature}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        {truncate(c.tx_signature)}
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Pump.fun */}
        <div className="bg-card border border-border rounded-none">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Pump.fun Revenue (Erys Share)
              </div>
              <div className="font-mono text-xl font-bold text-success">
                {formatSolNumber(pumpTotalErysSol)} SOL
              </div>
            </div>
            <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border border-success text-success rounded-none">
              Pump.fun
            </span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead>Token</TableHead>
                  <TableHead>Launch Date</TableHead>
                  <TableHead className="text-right">Total Fees</TableHead>
                  <TableHead className="text-right">Erys Share</TableHead>
                  <TableHead className="text-right">Creator Share</TableHead>
                  <TableHead>Last Claimed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pumpRows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground py-6 font-mono text-sm"
                    >
                      No Pump.fun fees claimed
                    </TableCell>
                  </TableRow>
                )}
                {pumpRows.map((l) => {
                  const total = Number(l.pumpfun_fees_claimed_total ?? 0);
                  return (
                    <TableRow key={l.id} className="border-border">
                      <TableCell className="font-medium">
                        {l.token_symbol}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatDate(l.launch_datetime)}
                      </TableCell>
                      <TableCell className="font-mono text-right">
                        {formatSol(total)}
                      </TableCell>
                      <TableCell className="font-mono text-right text-success">
                        {formatSolNumber(lamportsToSol(total * 0.5))}
                      </TableCell>
                      <TableCell className="font-mono text-right">
                        {formatSolNumber(lamportsToSol(total * 0.5))}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatDate(l.pumpfun_fees_last_claimed_at)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlatformRevenueTab;