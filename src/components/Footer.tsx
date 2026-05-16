import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Check, Pencil, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useWallet } from "@/hooks/useWallet";
import { toast } from "@/hooks/use-toast";

const CONTACT_EMAIL = "info@erys.live";
const FALLBACK_CONTRACT_ADDRESS = "4T1GVUfBjwhPv2GQiWP8GiUiq5GGhdybtVRJY733BAGS";
const SETTING_KEY = "footer_contract_address";

const Footer = () => {
  const year = new Date().getFullYear();
  const [copied, setCopied] = useState(false);
  const [contractAddress, setContractAddress] = useState<string>(FALLBACK_CONTRACT_ADDRESS);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const { isAdmin } = useIsAdmin();
  const { publicKey } = useWallet();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", SETTING_KEY)
        .maybeSingle();
      if (!cancelled && !error && data?.value) {
        setContractAddress(data.value);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(contractAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const startEdit = () => {
    setDraft(contractAddress);
    setEditing(true);
  };

  const saveEdit = async () => {
    const value = draft.trim();
    if (!value || !publicKey) return;
    setSaving(true);
    const { error } = await supabase.rpc("admin_set_app_setting", {
      p_admin_wallet: publicKey,
      p_key: SETTING_KEY,
      p_value: value,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Failed to update CA", description: error.message, variant: "destructive" });
      return;
    }
    setContractAddress(value);
    setEditing(false);
    toast({ title: "Contract address updated" });
  };
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
              The fair-launch presale platform for Solana tokens. Open a presale on Bags.fm or Pump.fun and let your community ape in early.
            </p>
          </div>

          <div>
            <h3 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              Platform
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/schedule" className="text-foreground transition-colors hover:text-primary">
                  Schedule launch
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

        <div className="mt-10 flex flex-col items-start justify-between gap-4 border-t border-border pt-6 text-xs text-muted-foreground md:flex-row md:items-center">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
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

            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                CA
              </span>
              {editing ? (
                <div className="flex items-center gap-1.5 rounded border border-primary/40 bg-card px-2 py-1">
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit();
                      if (e.key === "Escape") setEditing(false);
                    }}
                    disabled={saving}
                    className="w-[260px] bg-transparent font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground"
                    placeholder="Contract address"
                  />
                  <button
                    onClick={saveEdit}
                    disabled={saving}
                    className="text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
                    aria-label="Save contract address"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    disabled={saving}
                    className="text-muted-foreground transition-colors hover:text-destructive"
                    aria-label="Cancel"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 overflow-hidden rounded border border-border bg-card px-2 py-1 transition-colors hover:border-primary/30">
                  <span className="max-w-[200px] truncate font-mono text-[11px] text-foreground sm:max-w-[260px]">
                    {contractAddress}
                  </span>
                  <button
                    onClick={handleCopy}
                    className="flex shrink-0 items-center gap-1 text-muted-foreground transition-colors hover:text-primary"
                    aria-label="Copy contract address"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3 w-3" />
                        <span className="font-mono text-[10px]">Copied</span>
                      </>
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                  {isAdmin && (
                    <button
                      onClick={startEdit}
                      className="flex shrink-0 items-center text-muted-foreground transition-colors hover:text-primary"
                      aria-label="Edit contract address"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <span className="font-mono uppercase tracking-widest">
            Not financial advice · Crypto involves risk
          </span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;