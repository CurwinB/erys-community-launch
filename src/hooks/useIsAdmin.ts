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
      // admin_wallets is no longer publicly readable (it contains emails).
      // Use the SECURITY DEFINER membership-check RPC instead, which only
      // returns a boolean and never exposes the email column.
      const { data, error } = await supabase.rpc("is_admin_wallet", {
        p_wallet: address!,
      });
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
