import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

/**
 * PumpPortal custodial wallet pool.
 *
 * Auto-discovers wallets from environment variables. Slot 1 uses the
 * legacy unsuffixed names so single-wallet deployments need no migration.
 * Subsequent slots use _2, _3, _N suffixes:
 *
 *   PUMPPORTAL_CUSTODIAL_WALLET[_N]
 *   PUMPPORTAL_CUSTODIAL_PRIVATE_KEY[_N]
 *   PUMPPORTAL_API_KEY[_N]
 *
 * Adding a new wallet to the pool is purely a secrets + restart operation,
 * no code change required. The loader stops at the first numbered slot
 * whose secrets are missing; partial slots throw at boot with a clear
 * error so misconfiguration fails loudly.
 */

export interface PumpPortalWallet {
  /** 1-based slot index. Slot 1 uses the unsuffixed env names. */
  slot: number;
  /** Base58 public key. Stable identifier used for locks + DB rows. */
  pubkey: string;
  /** Cached PublicKey for hot-path use. */
  publicKey: PublicKey;
  /** Cached Keypair (constructed lazily on first read). */
  readonly keypair: Keypair;
  /** PumpPortal API key for this wallet. */
  apiKey: string;
}

let cachedPool: PumpPortalWallet[] | null = null;

function envFor(slot: number, base: string): string | undefined {
  const key = slot === 1 ? base : `${base}_${slot}`;
  return process.env[key];
}

function buildWallet(slot: number): PumpPortalWallet | null {
  const pubkeyEnv = envFor(slot, "PUMPPORTAL_CUSTODIAL_WALLET");
  const secretEnv = envFor(slot, "PUMPPORTAL_CUSTODIAL_PRIVATE_KEY");
  const apiKeyEnv = envFor(slot, "PUMPPORTAL_API_KEY");

  const present = [pubkeyEnv, secretEnv, apiKeyEnv].filter(Boolean).length;
  if (present === 0) return null;
  if (present !== 3) {
    throw new Error(
      `Pump.fun wallet slot ${slot} is partially configured. ` +
        `All three of PUMPPORTAL_CUSTODIAL_WALLET${slot === 1 ? "" : `_${slot}`}, ` +
        `PUMPPORTAL_CUSTODIAL_PRIVATE_KEY${slot === 1 ? "" : `_${slot}`}, ` +
        `PUMPPORTAL_API_KEY${slot === 1 ? "" : `_${slot}`} must be set together.`
    );
  }

  const secret = bs58.decode(secretEnv!);
  if (secret.length !== 64) {
    throw new Error(
      `Slot ${slot} private key decoded to ${secret.length} bytes, expected 64`
    );
  }
  const keypair = Keypair.fromSecretKey(new Uint8Array(secret));
  if (keypair.publicKey.toBase58() !== pubkeyEnv) {
    throw new Error(
      `Slot ${slot} private key public key ${keypair.publicKey.toBase58()} ` +
        `does not match configured wallet ${pubkeyEnv}`
    );
  }

  return {
    slot,
    pubkey: pubkeyEnv!,
    publicKey: keypair.publicKey,
    keypair,
    apiKey: apiKeyEnv!,
  };
}

/** Returns all configured wallets (slot 1 first, then 2, 3, ...). */
export function getAllWallets(): PumpPortalWallet[] {
  if (cachedPool) return cachedPool;
  const wallets: PumpPortalWallet[] = [];
  // Cap at 32 slots to bound work; we'd never realistically run more.
  for (let slot = 1; slot <= 32; slot++) {
    const w = buildWallet(slot);
    if (!w) {
      // First gap = end of pool. (Skipped slots are not supported on purpose.)
      if (wallets.length === 0 && slot === 1) {
        // No wallets at all — let the caller surface the error contextually.
        return (cachedPool = []);
      }
      break;
    }
    wallets.push(w);
  }
  return (cachedPool = wallets);
}

/** Throws if no wallets are configured. */
export function requireWallets(): PumpPortalWallet[] {
  const wallets = getAllWallets();
  if (wallets.length === 0) {
    throw new Error(
      "No PumpPortal custodial wallets configured. Set PUMPPORTAL_CUSTODIAL_WALLET, PUMPPORTAL_CUSTODIAL_PRIVATE_KEY, and PUMPPORTAL_API_KEY."
    );
  }
  return wallets;
}

/** Look up a wallet by its base58 public key. */
export function getWalletByPubkey(pubkey: string): PumpPortalWallet | null {
  return getAllWallets().find((w) => w.pubkey === pubkey) ?? null;
}

/**
 * Deterministically pick a wallet for a launch. We hash the launch ID and
 * mod by pool size, so the same launch always lands on the same wallet
 * (important for retries). Distribution across the pool is uniform for a
 * large enough sample of UUIDs.
 */
export function getWalletForLaunch(launchId: string): PumpPortalWallet {
  const wallets = requireWallets();
  if (wallets.length === 1) return wallets[0];
  // FNV-1a 32-bit hash of the launch ID — small, deterministic, no deps.
  let hash = 0x811c9dc5;
  for (let i = 0; i < launchId.length; i++) {
    hash ^= launchId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const idx = Math.abs(hash) % wallets.length;
  return wallets[idx];
}

/** For tests / hot-reload scenarios. */
export function _resetPoolCache(): void {
  cachedPool = null;
}