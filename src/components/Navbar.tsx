import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DynamicWidget } from "@dynamic-labs/sdk-react-core";
import WalletDropdown from "@/components/WalletDropdown";
import { useWallet } from "@/hooks/useWallet";

const Navbar = () => {
  const { connected } = useWallet();

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
            <Link to="/dashboard">
              <Button size="sm" variant="outline" className="hidden sm:inline-flex">
                Dashboard
              </Button>
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
