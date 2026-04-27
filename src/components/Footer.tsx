import { Link } from "react-router-dom";

const CONTACT_EMAIL = "info@erys.live";

const Footer = () => {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-background">
      <div className="container mx-auto px-4 py-12">
        <div className="grid gap-10 md:grid-cols-4">
          <div>
            <Link to="/" className="inline-flex items-center gap-1">
              <span className="text-xl font-bold tracking-tight text-foreground">
                erys<span className="text-primary">.</span>
              </span>
            </Link>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              The community launch platform for Solana tokens. Schedule launches on Bags.fm or Pump.fun.
            </p>
          </div>

          <div>
            <h3 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              Platform
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/schedule" className="text-foreground transition-colors hover:text-primary">
                  Schedule a Launch
                </Link>
              </li>
              <li>
                <Link to="/dashboard" className="text-foreground transition-colors hover:text-primary">
                  Dashboard
                </Link>
              </li>
              <li>
                <Link to="/#how-it-works" className="text-foreground transition-colors hover:text-primary">
                  How it works
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              Legal
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/terms" className="text-foreground transition-colors hover:text-primary">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="text-foreground transition-colors hover:text-primary">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link to="/risk" className="text-foreground transition-colors hover:text-primary">
                  Risk Disclosure
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              Contact
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="text-foreground transition-colors hover:text-primary"
                >
                  {CONTACT_EMAIL}
                </a>
              </li>
              <li>
                <Link to="/contact" className="text-foreground transition-colors hover:text-primary">
                  Contact us
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-border pt-6 text-xs text-muted-foreground md:flex-row md:items-center">
          <span>
            © {year} Erys. Launch on{" "}
            <a
              href="https://bags.fm"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground transition-colors hover:text-primary"
            >
              Bags.fm
            </a>{" "}
            or{" "}
            <a
              href="https://pump.fun"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground transition-colors hover:text-primary"
            >
              Pump.fun
            </a>
            .
          </span>
          <span className="font-mono uppercase tracking-widest">
            Not financial advice · Crypto involves risk
          </span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;