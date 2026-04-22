import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWallet } from "@/hooks/useWallet";

export function useIsAdmin() {
  const { publicKey, ready } = useWallet();
  const address = publicKey?.toLowerCase() ?? null;

  const { data, isLoading } = useQuery({
    queryKey: ["is-admin", address],
    enabled: ready && !!address,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_wallets")
        .select("wallet_address")
        .eq("wallet_address", address!)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });

  return {
    isAdmin: !!data,
    isLoading: !ready || (!!address && isLoading),
    hasWallet: !!address,
  };
}
