import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import * as crypto from "crypto";
import { supabase } from "./db";

/**
 * PumpPortal custodial wallet pool.
 *
 * HYBRID source of truth: Supabase `lightning_wallets` table FIRST, with
 * legacy Railway env vars as a fallback so launches never go down if the
 * DB is unreachable or empty.
 *
 * - DB rows: status='active' rows from `lightning_wallets`. Secrets stored
 *   AES-256-GCM encrypted with ESCROW_ENCRYPTION_KEY (`iv:authTag:ciphertext`
 *   hex), plaintext = bs58 secret string / api key string.
 * - Env vars (legacy slot 1 + numbered _N): see envFor() below. Always
 *   merged in; on dedup-by-pubkey collision the env entry wins so the
 *   live Railway wallet behaves byte-identically during cutover.
 * - 60s TTL cache, eagerly warmed on first call, refreshed in background.
 * - If the DB query fails for any reason we silently keep the previous
 *   pool (or fall back to env-only for the very first call). Launches
 *   never block on DB availability.
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
let cacheExpiresAt = 0;
let inFlightRefresh: Promise<PumpPortalWallet[]> | null = null;
const POOL_TTL_MS = 60_000;

function envFor(slot: number, base: string): string | undefined {
  const key = slot === 1 ? base : `${base}_${slot}`;
  return process.env[key];
}

function buildWalletFromEnv(slot: number): PumpPortalWallet | null {
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

function loadEnvWallets(): PumpPortalWallet[] {
  const wallets: PumpPortalWallet[] = [];
  for (let slot = 1; slot <= 32; slot++) {
    const w = buildWalletFromEnv(slot);
    if (!w) {
      if (wallets.length === 0 && slot === 1) return [];
      break;
    }
    wallets.push(w);
  }
  return wallets;
}

function decryptToString(encrypted: string): string {
  const encryptionKeyHex = process.env.ESCROW_ENCRYPTION_KEY!;
  if (!encryptionKeyHex) throw new Error("ESCROW_ENCRYPTION_KEY not set");
  const [ivHex, authTagHex, ciphertextHex] = encrypted.split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Invalid encrypted format (expected iv:authTag:ciphertext)");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(encryptionKeyHex, "hex"),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const out = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]);
  return out.toString("utf8");
}

async function loadDbWallets(): Promise<PumpPortalWallet[]> {
  const { data, error } = await supabase
    .from("lightning_wallets")
    .select("slot, pubkey, encrypted_secret_key, encrypted_api_key, status")
    .eq("status", "active")
    .order("slot", { ascending: true });
  if (error) throw error;
  const wallets: PumpPortalWallet[] = [];
  for (const row of data ?? []) {
    try {
      const secretBs58 = decryptToString(row.encrypted_secret_key);
      const apiKey = decryptToString(row.encrypted_api_key);
      const secretBytes = bs58.decode(secretBs58);
      if (secretBytes.length !== 64) {
        console.warn(
          `[wallet pool] DB slot ${row.slot} (${row.pubkey}) bad secret length ${secretBytes.length}; skipping`,
        );
        continue;
      }
      const keypair = Keypair.fromSecretKey(new Uint8Array(secretBytes));
      if (keypair.publicKey.toBase58() !== row.pubkey) {
        console.warn(
          `[wallet pool] DB slot ${row.slot} pubkey mismatch (stored ${row.pubkey}, derived ${keypair.publicKey.toBase58()}); skipping`,
        );
        continue;
      }
      wallets.push({
        slot: row.slot,
        pubkey: row.pubkey,
        publicKey: keypair.publicKey,
        keypair,
        apiKey,
      });
    } catch (err: any) {
      console.warn(
        `[wallet pool] failed to load DB wallet slot ${row.slot}: ${err?.message ?? err}`,
      );
    }
  }
  return wallets;
}

async function refreshPool(): Promise<PumpPortalWallet[]> {
  const envWallets = loadEnvWallets();
  let dbWallets: PumpPortalWallet[] = [];
  try {
    dbWallets = await loadDbWallets();
  } catch (err: any) {
    console.warn(
      `[wallet pool] DB load failed (${err?.message ?? err}); ` +
        `using env-only fallback (${envWallets.length} wallets)`,
    );
    cachedPool = envWallets;
    cacheExpiresAt = Date.now() + POOL_TTL_MS;
    return envWallets;
  }

  // Merge: env wins on pubkey collision so live wallet behavior is identical.
  const byPubkey = new Map<string, PumpPortalWallet>();
  for (const w of dbWallets) byPubkey.set(w.pubkey, w);
  for (const w of envWallets) byPubkey.set(w.pubkey, w);

  const merged = Array.from(byPubkey.values()).sort((a, b) => a.slot - b.slot);
  if (merged.length === 0 && envWallets.length > 0) {
    cachedPool = envWallets;
  } else {
    cachedPool = merged;
  }
  cacheExpiresAt = Date.now() + POOL_TTL_MS;
  return cachedPool;
}

function ensurePoolSync(): PumpPortalWallet[] {
  // Fire-and-forget background refresh if expired and not already refreshing.
  if (Date.now() >= cacheExpiresAt && !inFlightRefresh) {
    inFlightRefresh = refreshPool().finally(() => {
      inFlightRefresh = null;
    });
    // First-call cold path: synchronously fall back to env so callers don't
    // have to await. The next call after refresh completes will see DB rows.
    if (cachedPool === null) {
      cachedPool = loadEnvWallets();
      cacheExpiresAt = Date.now() + 5_000; // short TTL until first DB load lands
    }
  }
  return cachedPool ?? [];
}

/** Eagerly warm the pool. Call once at boot. */
export async function warmWalletPool(): Promise<void> {
  try {
    await refreshPool();
    console.log(`[wallet pool] warmed: ${cachedPool?.length ?? 0} wallets`);
  } catch (err: any) {
    console.warn(`[wallet pool] warm failed: ${err?.message ?? err}`);
  }
}

/** Returns all configured wallets (slot 1 first, then 2, 3, ...). */
export function getAllWallets(): PumpPortalWallet[] {
  return ensurePoolSync();
}

/** Throws if no wallets are configured. */
export function requireWallets(): PumpPortalWallet[] {
  const wallets = getAllWallets();
  if (wallets.length === 0) {
    throw new Error(
      "No PumpPortal custodial wallets available (DB + env both empty). " +
        "Add one via the admin Lightning Wallets tab, or set PUMPPORTAL_CUSTODIAL_WALLET/_PRIVATE_KEY/API_KEY.",
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
  cacheExpiresAt = 0;
  inFlightRefresh = null;
}