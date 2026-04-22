import { Button } from "@/components/ui/button";
import { Lock, Loader2 } from "lucide-react";
import { DynamicWidget, useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { useWallet } from "@/hooks/useWallet";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useEffect } from "react";

interface Props {
  onAuthenticated: () => void;
}

const AdminGate = ({ onAuthenticated }: Props) => {
  const { ready, connected, publicKey } = useWallet();
  const { isAdmin, isLoading } = useIsAdmin();
  const { handleLogOut } = useDynamicContext();

  useEffect(() => {
    if (isAdmin) {
      sessionStorage.setItem("admin_authenticated", "true");
      onAuthenticated();
    }
  }, [isAdmin, onAuthenticated]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm bg-card border border-border p-8 rounded-none">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 flex items-center justify-center bg-destructive/10 border border-destructive/30 rounded-none">
            <Lock className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <div className="text-xl font-bold tracking-tight">
              erys<span className="text-primary">.</span>
            </div>
            <div className="text-xs text-destructive uppercase tracking-widest font-mono">
              Admin Access
            </div>
          </div>
        </div>

        {!ready ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading wallet…
          </div>
        ) : !connected ? (
          <>
            <p className="text-sm text-muted-foreground font-mono mb-4">
              Connect your admin wallet to continue.
            </p>
            <DynamicWidget />
          </>
        ) : isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verifying access…
          </div>
        ) : !isAdmin ? (
          <>
            <p className="text-sm text-destructive font-mono mb-2">
              This wallet does not have admin access.
            </p>
            <p className="text-xs font-mono text-muted-foreground mb-4 break-all">
              {publicKey}
            </p>
            <Button
              variant="outline"
              className="w-full rounded-none"
              onClick={() => handleLogOut()}
            >
              Disconnect & try another wallet
            </Button>
          </>
        ) : (
          <div className="flex items-center gap-2 text-sm text-primary font-mono">
            <Loader2 className="h-4 w-4 animate-spin" />
            Unlocking dashboard…
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminGate;
