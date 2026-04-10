import { Button } from "@/components/ui/button";
import { Wallet, LogOut } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { shortenAddress } from "@/lib/constants";

const WalletButton = () => {
  const { connected, publicKey, connect, disconnect } = useWallet();

  if (connected && publicKey) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
          {shortenAddress(publicKey)}
        </span>
        <Button variant="outline" size="sm" className="gap-2" onClick={disconnect}>
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Disconnect</span>
        </Button>
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" className="gap-2" onClick={connect}>
      <Wallet className="h-4 w-4" />
      <span className="hidden sm:inline">Connect Wallet</span>
    </Button>
  );
};

export default WalletButton;
