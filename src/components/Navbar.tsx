import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DynamicWidget } from "@dynamic-labs/sdk-react-core";
import WalletDropdown from "@/components/WalletDropdown";
import { useWallet } from "@/hooks/useWallet";
import { useDashboardNotifications } from "@/hooks/useDashboardNotifications";

const Navbar = () => {
  const { connected } = useWallet();
  const { hasUnread } = useDashboardNotifications();

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-xl font-bold tracking-tight text-foreground">
            erys<span className="text-primary">.</span>
          </span>
        </Link>

        <div className="flex items-center gap-3">
          <Link to="/schedule">
            <Button size="sm" className="hidden sm:inline-flex">
              Schedule a Launch
            </Button>
          </Link>
          {connected && (
            <Link to="/dashboard" className="relative hidden sm:inline-flex">
              <Button size="sm" variant="outline">
                Dashboard
              </Button>
              {hasUnread && (
                <span className="pointer-events-none absolute -right-1 -top-1 flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                </span>
              )}
            </Link>
          )}
          {connected ? (
            <>
              <WalletDropdown />
              <div className="hidden">
                <DynamicWidget />
              </div>
            </>
          ) : (
            <DynamicWidget />
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
