import { useState, FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock } from "lucide-react";

// NOTE: VITE_* env vars are bundled into the client JS. Anyone who downloads
// the JS can extract this password. This is intentional for an internal-only
// gate — do NOT treat as real authentication.
interface Props {
  onAuthenticated: () => void;
}

const AdminGate = ({ onAuthenticated }: Props) => {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const expected = import.meta.env.VITE_ADMIN_PASSWORD as string | undefined;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!expected) {
      setError("Admin password not configured (VITE_ADMIN_PASSWORD missing)");
      return;
    }
    if (password === expected) {
      sessionStorage.setItem("admin_authenticated", "true");
      setError("");
      onAuthenticated();
    } else {
      setError("Incorrect password");
      setPassword("");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-card border border-border p-8 rounded-none"
      >
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

        <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
          Password
        </label>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          className="rounded-none font-mono mb-3"
          placeholder="••••••••"
        />
        {error && (
          <p className="text-sm text-destructive font-mono mb-3">{error}</p>
        )}
        <Button type="submit" className="w-full rounded-none">
          Unlock Dashboard
        </Button>
      </form>
    </div>
  );
};

export default AdminGate;