export type SavedWalletPlatform = "pumpfun" | "bags";

export interface SavedWallet {
  address: string;
  label: string;
  platforms: SavedWalletPlatform[];
  lastUsedAt: number;
}

const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidSolanaAddress(addr: string): boolean {
  return SOLANA_ADDR_RE.test(addr.trim());
}

export function truncateAddress(addr: string, head = 4, tail = 4): string {
  if (!addr) return "";
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

function key(owner: string) {
  return `erys.savedWallets.${owner}`;
}

function safeRead(owner: string): SavedWallet[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key(owner));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (w) =>
          w &&
          typeof w.address === "string" &&
          Array.isArray(w.platforms) &&
          isValidSolanaAddress(w.address)
      )
      .map((w) => ({
        address: w.address,
        label: typeof w.label === "string" ? w.label : "",
        platforms: (w.platforms as string[]).filter(
          (p): p is SavedWalletPlatform => p === "pumpfun" || p === "bags"
        ),
        lastUsedAt: typeof w.lastUsedAt === "number" ? w.lastUsedAt : 0,
      }));
  } catch {
    return [];
  }
}

function safeWrite(owner: string, list: SavedWallet[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(owner), JSON.stringify(list));
  } catch {
    // ignore quota/serialization errors
  }
}

export function listSavedWallets(
  owner: string | null | undefined,
  platform?: SavedWalletPlatform
): SavedWallet[] {
  if (!owner) return [];
  const all = safeRead(owner);
  const filtered = platform
    ? all.filter((w) => w.platforms.includes(platform))
    : all;
  return filtered.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export function saveWallet(
  owner: string | null | undefined,
  entry: { address: string; label?: string; platform: SavedWalletPlatform }
): SavedWallet | null {
  if (!owner) return null;
  const address = entry.address.trim();
  if (!isValidSolanaAddress(address)) return null;
  const all = safeRead(owner);
  const existing = all.find((w) => w.address === address);
  let saved: SavedWallet;
  if (existing) {
    if (!existing.platforms.includes(entry.platform)) {
      existing.platforms.push(entry.platform);
    }
    if (entry.label && entry.label.trim()) {
      existing.label = entry.label.trim().slice(0, 40);
    }
    existing.lastUsedAt = Date.now();
    saved = existing;
  } else {
    saved = {
      address,
      label: (entry.label || "").trim().slice(0, 40),
      platforms: [entry.platform],
      lastUsedAt: Date.now(),
    };
    all.push(saved);
  }
  safeWrite(owner, all);
  return saved;
}

export function touchSavedWallet(
  owner: string | null | undefined,
  address: string
) {
  if (!owner) return;
  const all = safeRead(owner);
  const found = all.find((w) => w.address === address.trim());
  if (!found) return;
  found.lastUsedAt = Date.now();
  safeWrite(owner, all);
}

export function removeSavedWallet(
  owner: string | null | undefined,
  address: string
) {
  if (!owner) return;
  const all = safeRead(owner).filter((w) => w.address !== address.trim());
  safeWrite(owner, all);
}

export function renameSavedWallet(
  owner: string | null | undefined,
  address: string,
  label: string
) {
  if (!owner) return;
  const all = safeRead(owner);
  const found = all.find((w) => w.address === address.trim());
  if (!found) return;
  found.label = label.trim().slice(0, 40);
  safeWrite(owner, all);
}