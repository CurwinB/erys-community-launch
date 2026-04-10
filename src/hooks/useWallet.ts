import { usePrivy, useSolanaWallets } from "@privy-io/react-auth";
import { useCallback, useMemo } from "react";

export function useWallet() {
  const { login, logout, authenticated, ready } = usePrivy();
  const { wallets } = useSolanaWallets();

  const wallet = wallets[0] ?? null;
  const publicKey = wallet?.address ?? null;

  const connect = useCallback(() => {
    if (!authenticated) login();
  }, [authenticated, login]);

  const disconnect = useCallback(() => {
    logout();
  }, [logout]);

  const signTransaction = useCallback(
    async (transaction: Uint8Array): Promise<Uint8Array> => {
      if (!wallet) throw new Error("No wallet connected");
      // Privy's signTransaction preserves existing partial signatures
      const signed = await wallet.signTransaction(transaction);
      return signed;
    },
    [wallet]
  );

  const sendTransaction = useCallback(
    async (transaction: Uint8Array): Promise<string> => {
      if (!wallet) throw new Error("No wallet connected");
      const result = await wallet.sendTransaction(transaction);
      // sendTransaction returns the tx signature string
      return typeof result === "string" ? result : (result as any).signature;
    },
    [wallet]
  );

  return useMemo(
    () => ({
      ready,
      connected: authenticated && !!publicKey,
      publicKey,
      wallet,
      connect,
      disconnect,
      signTransaction,
      sendTransaction,
    }),
    [ready, authenticated, publicKey, wallet, connect, disconnect, signTransaction, sendTransaction]
  );
}
