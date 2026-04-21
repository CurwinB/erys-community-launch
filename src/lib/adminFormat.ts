const LAMPORTS_PER_SOL = 1_000_000_000;

const solFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const intFormatter = new Intl.NumberFormat("en-US");

export function lamportsToSol(lamports: number | bigint | null | undefined): number {
  if (lamports == null) return 0;
  return Number(lamports) / LAMPORTS_PER_SOL;
}

export function formatSol(lamports: number | bigint | null | undefined): string {
  return solFormatter.format(lamportsToSol(lamports));
}

export function formatSolNumber(sol: number): string {
  return solFormatter.format(sol);
}

export function formatInt(n: number | bigint | null | undefined): string {
  if (n == null) return "0";
  return intFormatter.format(Number(n));
}

export function formatPercent(basisPoints: number | null | undefined): string {
  if (basisPoints == null) return "—";
  return `${(basisPoints / 100).toFixed(2)}%`;
}

export function truncate(s: string | null | undefined, head = 4, tail = 4): string {
  if (!s) return "—";
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export const ATA_RENT_LAMPORTS = 2_039_280;
export const ATA_TX_FEE_LAMPORTS = 5_000;
export const GAS_RESERVE_LAMPORTS = 50_000;

export function ataReserveLamports(contributorCount: number): number {
  return contributorCount * (ATA_RENT_LAMPORTS + ATA_TX_FEE_LAMPORTS);
}