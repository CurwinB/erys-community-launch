import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LAUNCH_PUBLIC_COLUMNS } from "@/lib/constants";
import { useWallet } from "@/hooks/useWallet";

const DISMISSED_KEY = "erys.dismissedNotifications";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const FEE_THRESHOLD_SOL = 0.001;

export interface ClaimablePosition {
  baseMint: string;
  claimableDisplayAmount: number;
  totalClaimableLamportsUserShare: number;
}

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: string[]) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));
  } catch {
    /* noop */
  }
}

export function useDashboardNotifications() {
  const { connected, publicKey } = useWallet();
  const walletAddress = publicKey || "";
  const [dismissedIds, setDismissedIds] = useState<string[]>(() => readDismissed());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === DISMISSED_KEY) setDismissedIds(readDismissed());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const dismiss = useCallback((id: string) => {
    setDismissedIds((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      writeDismissed(next);
      return next;
    });
  }, []);

  const { data: contributions = [], isLoading: contribsLoading } = useQuery({
    queryKey: ["dashboard-contributions", walletAddress],
    enabled: connected && !!walletAddress,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "list_my_contributions" as any,
        { p_wallet: walletAddress! } as any
      );
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const { data: claimablePositions = [], isLoading: positionsLoading } = useQuery({
    queryKey: ["claimable-positions", walletAddress],
    enabled: connected && !!walletAddress,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.functions.invoke("claim-fees", {
          body: { action: "claimable-positions", wallet: walletAddress },
        });
        if (error) throw error;
        // Normalize: accept raw array, or wrapped { response: [...] } / { data: [...] }
        const raw: any = data;
        const arr = Array.isArray(raw)
          ? raw
          : Array.isArray(raw?.response)
            ? raw.response
            : Array.isArray(raw?.data)
              ? raw.data
              : [];
        return arr as ClaimablePosition[];
      } catch (err) {
        console.warn("[useDashboardNotifications] claimable-positions failed:", err);
        return [] as ClaimablePosition[];
      }
    },
    refetchInterval: 30000,
  });

  const getClaimableForMint = useCallback(
    (mint: string | null | undefined): number => {
      if (!mint) return 0;
      if (!Array.isArray(claimablePositions)) return 0;
      const pos = claimablePositions.find((p) => p?.baseMint === mint);
      return pos?.claimableDisplayAmount || 0;
    },
    [claimablePositions]
  );

  const tokenNotifications = useMemo(() => {
    const now = Date.now();
    return (contributions as any[]).filter((c) => {
      if (!c.tokens_distributed) return false;
      if (dismissedIds.includes(c.id)) return false;
      const completedAt = c.launches?.distribution_completed_at;
      if (!completedAt) return false;
      return now - new Date(completedAt).getTime() <= SEVEN_DAYS_MS;
    });
  }, [contributions, dismissedIds]);

  const feeNotifications = useMemo(() => {
    return (contributions as any[]).filter((c) => {
      if (c.launches?.platform !== "bags") return false;
      if (c.is_fee_claimer === false) return false;
      const claimable = getClaimableForMint(c.launches?.token_mint_address);
      return claimable > FEE_THRESHOLD_SOL;
    });
  }, [contributions, getClaimableForMint]);

  const upcomingNotifications = useMemo(() => {
    const now = Date.now();
    const seen = new Set<string>();
    return (contributions as any[]).filter((c) => {
      if (c.launches?.status !== "scheduled") return false;
      const launchTs = c.launches?.launch_datetime
        ? new Date(c.launches.launch_datetime).getTime()
        : 0;
      const delta = launchTs - now;
      if (delta <= 0 || delta > TWO_HOURS_MS) return false;
      const launchId = c.launches?.id;
      if (launchId && seen.has(launchId)) return false;
      if (launchId) seen.add(launchId);
      return true;
    });
  }, [contributions]);

  const hasUnread =
    tokenNotifications.length > 0 ||
    feeNotifications.length > 0 ||
    upcomingNotifications.length > 0;

  return {
    contributions: contributions as any[],
    claimablePositions,
    getClaimableForMint,
    tokenNotifications,
    feeNotifications,
    upcomingNotifications,
    hasUnread,
    dismiss,
    dismissedIds,
    isLoading: contribsLoading || positionsLoading,
  };
}
