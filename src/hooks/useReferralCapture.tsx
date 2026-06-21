import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWallet } from "@/hooks/useWallet";

const STORAGE_KEY = "erys_ref_code";

export function storeReferralCode(code: string) {
  try {
    localStorage.setItem(STORAGE_KEY, code.toUpperCase());
  } catch {
    /* ignore */
  }
}

export function readReferralCode(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function clearReferralCode() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Mount once at the app root. When a wallet first connects and a referral
 * code is sitting in localStorage (placed there by /r/:code), fire the
 * attribute-referral edge function. Server-side is idempotent and blocks
 * self-referral / already-attributed / inactive codes.
 */
export function useReferralCapture() {
  const { connected, publicKey } = useWallet();

  useEffect(() => {
    if (!connected || !publicKey) return;
    const code = readReferralCode();
    if (!code) return;

    let cancelled = false;
    (async () => {
      try {
        const { error } = await supabase.functions.invoke("attribute-referral", {
          body: { wallet: publicKey, code },
        });
        if (cancelled) return;
        if (error) {
          console.warn("[referral] attribution failed", error);
          return;
        }
        // Whatever the server says (attributed / already / self / invalid),
        // we clear the code so we don't keep retrying on every reload.
        clearReferralCode();
      } catch (err) {
        console.warn("[referral] attribution exception", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connected, publicKey]);
}