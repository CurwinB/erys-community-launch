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

interface Contribution {
  id: string;
  launch_id: string;
  wallet_address: string;
  amount_lamports: number;
  refund_tx_signature: string | null;
  contributed_at: string;
  refund_shortfall_lamports?: number | null;
}

interface Launch {
  id: string;
  token_symbol: string;
  status: string;
}

interface Props {
  contributions: Contribution[];
  launches: Launch[];
}

const RefundsTab = ({ contributions, launches }: Props) => {
  const launchMap = useMemo(() => {
    const m = new Map<string, Launch>();
    launches.forEach((l) => m.set(l.id, l));
    return m;
  }, [launches]);

  const refunded = useMemo(
    () => contributions.filter((c) => c.refund_tx_signature),
    [contributions],
  );

  const totalRefundedSol = useMemo(
    () =>
      lamportsToSol(
        refunded.reduce((sum, c) => sum + Number(c.amount_lamports), 0),
      ),
    [refunded],
  );

  const reasonFor = (launchId: string) => {
    const l = launchMap.get(launchId);
    return l?.status === "cancelled" ? "Launch cancelled" : "Other";
  };

  const totalShortfallSol = useMemo(
    () =>
      lamportsToSol(
        refunded.reduce(
          (sum, c) => sum + Number(c.refund_shortfall_lamports ?? 0),
          0,
        ),
      ),
    [refunded],
  );

  const hasShortfalls = totalShortfallSol > 0;

  const handleExport = () => {
    const rows = refunded.map((c) => ({
      launch_id: c.launch_id,
      token: launchMap.get(c.launch_id)?.token_symbol ?? "",
      wallet: c.wallet_address,
      sol_refunded: lamportsToSol(c.amount_lamports).toFixed(4),
      sol_shortfall: lamportsToSol(
        Number(c.refund_shortfall_lamports ?? 0),
      ).toFixed(4),
      refund_tx: c.refund_tx_signature ?? "",
      contribution_date: c.contributed_at,
      reason: reasonFor(c.launch_id),
    }));
    exportToCsv("erys-refunds", rows);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="bg-card border border-destructive/40 rounded-none p-4 flex-1">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
            Total SOL Refunded
          </div>
          <div className="font-mono text-2xl font-bold text-destructive">
            {formatSolNumber(totalRefundedSol)} SOL
          </div>
        </div>
        {hasShortfalls && (
          <div className="bg-card border border-warning/40 rounded-none p-4 flex-1">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
              Total Shortfall
            </div>
            <div className="font-mono text-2xl font-bold text-warning">
              {formatSolNumber(totalShortfallSol)} SOL
            </div>
          </div>
        )}
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
              <TableHead>Launch</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Wallet</TableHead>
              <TableHead className="text-right">SOL Refunded</TableHead>
              <TableHead className="text-right">Shortfall</TableHead>
              <TableHead>Refund TX</TableHead>
              <TableHead>Refund Date</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {refunded.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-muted-foreground py-8 font-mono text-sm"
                >
                  No refunds
                </TableCell>
              </TableRow>
            )}
            {refunded.map((c) => {
              const l = launchMap.get(c.launch_id);
              const shortfallLamports = Number(c.refund_shortfall_lamports ?? 0);
              return (
                <TableRow key={c.id} className="border-border">
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {truncate(c.launch_id, 6, 4)}
                  </TableCell>
                  <TableCell className="font-medium">
                    {l?.token_symbol ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {truncate(c.wallet_address)}
                  </TableCell>
                  <TableCell className="font-mono text-right text-destructive">
                    {formatSol(c.amount_lamports)}
                  </TableCell>
                  <TableCell
                    className={`font-mono text-right ${
                      shortfallLamports > 0
                        ? "text-warning"
                        : "text-muted-foreground"
                    }`}
                  >
                    {shortfallLamports > 0 ? formatSol(shortfallLamports) : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {c.refund_tx_signature ? (
                      <a
                        href={`https://solscan.io/tx/${c.refund_tx_signature}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        {truncate(c.refund_tx_signature)}
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatDate(c.contributed_at)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {reasonFor(c.launch_id)}
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

export default RefundsTab;