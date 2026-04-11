import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { isSolanaWallet } from "@dynamic-labs/solana";
import { useMemo } from "react";

export function useWallet() {
  const { primaryWallet, sdkHasLoaded } = useDynamicContext();

  const publicKey = primaryWallet?.address || null;
  const connected = !!primaryWallet && isSolanaWallet(primaryWallet);
  const wallet = primaryWallet && isSolanaWallet(primaryWallet) ? primaryWallet : null;

  return useMemo(
    () => ({
      ready: sdkHasLoaded,
      connected,
      publicKey,
      wallet,
    }),
    [sdkHasLoaded, connected, publicKey, wallet]
  );
}
