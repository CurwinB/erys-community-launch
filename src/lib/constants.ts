export const LAMPORTS_PER_SOL = 1_000_000_000;

export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

export function solToLamports(sol: number): number {
  return Math.floor(sol * LAMPORTS_PER_SOL);
}

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function formatSol(lamports: number): string {
  return lamportsToSol(lamports).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

// Public, sanitized launch columns. The base `launches` table is no longer
// publicly readable; the browser must query the `launches_public` view.
// This list mirrors the columns exposed by that view (see migration
// 20260427_lockdown_launches.sql).
export const LAUNCH_PUBLIC_COLUMNS = "*" as const;
