import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Trash2, Pencil, Check, X, Wallet } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import {
  isValidSolanaAddress,
  listSavedWallets,
  removeSavedWallet,
  renameSavedWallet,
  truncateAddress,
  type SavedWallet,
  type SavedWalletPlatform,
} from "@/lib/savedWallets";

interface Props {
  platform: SavedWalletPlatform;
  value: string;
  onChange: (next: string) => void;
  saveEnabled: boolean;
  onSaveEnabledChange: (next: boolean) => void;
  saveLabel: string;
  onSaveLabelChange: (next: string) => void;
  disabled?: boolean;
  inputClassName?: string;
  placeholder?: string;
}

export default function SavedWalletField({
  platform,
  value,
  onChange,
  saveEnabled,
  onSaveEnabledChange,
  saveLabel,
  onSaveLabelChange,
  disabled,
  inputClassName,
  placeholder = "Enter Solana wallet address",
}: Props) {
  const { publicKey } = useWallet();
  const [version, setVersion] = useState(0);
  const [manageOpen, setManageOpen] = useState(false);

  const saved = useMemo(
    () => listSavedWallets(publicKey, platform),
    [publicKey, platform, version, manageOpen]
  );

  const trimmed = value.trim();
  const isValid = isValidSolanaAddress(trimmed);
  const matchesExisting = saved.some((w) => w.address === trimmed);
  const showSaveToggle = !!publicKey && isValid && !matchesExisting;

  useEffect(() => {
    if (!showSaveToggle && saveEnabled) onSaveEnabledChange(false);
  }, [showSaveToggle, saveEnabled, onSaveEnabledChange]);

  return (
    <div className="space-y-2">
      {saved.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Saved
          </span>
          {saved.map((w) => {
            const active = w.address === trimmed;
            return (
              <button
                key={w.address}
                type="button"
                disabled={disabled}
                onClick={() => onChange(w.address)}
                className={`group flex items-center gap-1.5 border px-2 py-1 text-[10px] transition-colors ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-foreground hover:border-primary/60 hover:text-primary"
                }`}
              >
                <Wallet className="h-3 w-3" />
                <span className="font-medium">
                  {w.label || truncateAddress(w.address)}
                </span>
                {w.label && (
                  <span className="font-mono text-muted-foreground">
                    {truncateAddress(w.address, 3, 3)}
                  </span>
                )}
              </button>
            );
          })}
          <Dialog open={manageOpen} onOpenChange={setManageOpen}>
            <DialogTrigger asChild>
              <button
                type="button"
                className="text-[10px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
              >
                Manage
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Saved wallets</DialogTitle>
              </DialogHeader>
              <ManageList
                owner={publicKey}
                platform={platform}
                onChanged={() => setVersion((v) => v + 1)}
              />
            </DialogContent>
          </Dialog>
        </div>
      )}

      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClassName}
        disabled={disabled}
      />

      {showSaveToggle && (
        <div className="flex items-center gap-2">
          <Checkbox
            id={`save-wallet-${platform}`}
            checked={saveEnabled}
            onCheckedChange={(c) => onSaveEnabledChange(c === true)}
            disabled={disabled}
          />
          <label
            htmlFor={`save-wallet-${platform}`}
            className="text-[11px] text-muted-foreground cursor-pointer"
          >
            Save this wallet
          </label>
          {saveEnabled && (
            <Input
              placeholder="Label (optional)"
              value={saveLabel}
              onChange={(e) => onSaveLabelChange(e.target.value.slice(0, 40))}
              className="h-7 flex-1 text-xs"
              disabled={disabled}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ManageList({
  owner,
  platform,
  onChanged,
}: {
  owner: string | null;
  platform: SavedWalletPlatform;
  onChanged: () => void;
}) {
  const [tick, setTick] = useState(0);
  const items = useMemo(() => listSavedWallets(owner), [owner, tick]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (!owner) return <p className="text-xs text-muted-foreground">Connect a wallet to manage saved entries.</p>;
  if (items.length === 0)
    return <p className="text-xs text-muted-foreground">No saved wallets yet.</p>;

  const refresh = () => {
    setTick((t) => t + 1);
    onChanged();
  };

  return (
    <div className="space-y-2">
      {items.map((w: SavedWallet) => {
        const isEditing = editing === w.address;
        return (
          <div
            key={w.address}
            className="flex items-center gap-2 border border-border bg-card p-2"
          >
            <div className="min-w-0 flex-1 space-y-0.5">
              {isEditing ? (
                <Input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, 40))}
                  className="h-7 text-xs"
                />
              ) : (
                <p className="truncate text-xs font-medium text-foreground">
                  {w.label || truncateAddress(w.address)}
                </p>
              )}
              <p className="truncate font-mono text-[10px] text-muted-foreground">
                {w.address}
              </p>
              <p className="text-[9px] uppercase tracking-widest text-muted-foreground">
                {w.platforms.join(" · ")}
                {!w.platforms.includes(platform) && " (other platform)"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {isEditing ? (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => {
                      renameSavedWallet(owner, w.address, draft);
                      setEditing(null);
                      refresh();
                    }}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setEditing(null)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => {
                      setEditing(w.address);
                      setDraft(w.label);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => {
                      removeSavedWallet(owner, w.address);
                      refresh();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}