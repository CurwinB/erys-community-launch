import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";
import { useCallback, useMemo } from "react";

export function useWallet() {
  const { login, logout, authenticated, ready } = usePrivy();
  const { wallets } = useWallets();

  const wallet = wallets[0] ?? null;
  const publicKey = wallet?.address ?? null;

  const connect = useCallback(() => {
    if (!authenticated) login();
  }, [authenticated, login]);

  const disconnect = useCallback(() => {
    logout();
  }, [logout]);

  return useMemo(
    () => ({
      ready,
      connected: authenticated && !!publicKey,
      publicKey,
      wallet,
      connect,
      disconnect,
    }),
    [ready, authenticated, publicKey, wallet, connect, disconnect]
  );
}
