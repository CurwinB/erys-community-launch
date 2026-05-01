import { formatSol, shortenAddress } from "@/lib/constants";

interface Contribution {
  id: string;
  wallet_address: string;
  amount_lamports: number;
}

interface ContributionFeedProps {
  contributions: Contribution[];
}

const ContributionFeed = ({ contributions }: ContributionFeedProps) => (
  <div className="border border-border bg-card">
    <div className="border-b border-border p-4">
      <h3 className="text-sm font-semibold text-foreground">Recent Apes</h3>
    </div>
    <div className="max-h-64 overflow-y-auto">
      {contributions.length > 0 ? (
        contributions.map((c) => (
          <div key={c.id} className="flex items-center justify-between border-b border-border px-4 py-3 last:border-0">
            <span className="font-mono text-xs text-muted-foreground">{shortenAddress(c.wallet_address)}</span>
            <span className="font-mono text-sm font-semibold text-primary">{formatSol(Number(c.amount_lamports))} SOL</span>
          </div>
        ))
      ) : (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">No apes yet. Be first in.</div>
      )}
    </div>
  </div>
);

export default ContributionFeed;
