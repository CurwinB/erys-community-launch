import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Wallet } from "lucide-react";

const Navbar = () => {
  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-xl font-bold tracking-tight text-foreground">
            erys<span className="text-primary">.</span>
          </span>
        </Link>

        <span className="hidden text-xs text-muted-foreground md:block">
          Powered by{" "}
          <a
            href="https://bags.fm"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:text-primary transition-colors"
          >
            Bags.fm
          </a>
        </span>

        <div className="flex items-center gap-3">
          <Link to="/schedule">
            <Button size="sm" className="hidden sm:inline-flex">
              Schedule a Launch
            </Button>
          </Link>
          <Button variant="outline" size="sm" className="gap-2">
            <Wallet className="h-4 w-4" />
            <span className="hidden sm:inline">Connect Wallet</span>
          </Button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
