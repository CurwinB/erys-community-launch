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

// Column list for the `launches` table excluding encrypted private-key
// material. The frontend never needs the encrypted keys (only edge functions
// using service_role do), and column-level GRANT revokes block them anyway.
// Use this everywhere instead of `select("*")` to avoid permission errors.
// Declared `as const` so Supabase's typegen can still infer the row shape.
export const LAUNCH_PUBLIC_COLUMNS =
  "id,token_name,token_symbol,description,image_url,twitter_url,telegram_url,website_url,token_mint_address,ipfs_metadata_url,escrow_wallet_public_key,launch_datetime,min_contribution_lamports,max_contribution_lamports,status,execution_error,execution_attempts,created_by_wallet,created_at,fee_share_config_key,claimer_count,excluded_contributors,total_tokens_distributed,distribution_completed,distribution_completed_at,platform,pumpfun_launch_signature,pumpfun_fees_last_claimed_at,pumpfun_fees_claimed_total,pumpfun_creator_fees_distributed,worker_id,worker_locked_at,is_sponsored,sponsored_by,sponsored_amount_lamports,sponsored_tx_signature,sponsor_link_token,sponsor_link_expires_at,sponsor_link_claimed_at,processing_fee_lamports,processing_fee_tx_signature" as const;
