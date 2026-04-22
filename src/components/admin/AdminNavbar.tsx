import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";

const AdminNavbar = () => {
  const navigate = useNavigate();
  const { handleLogOut } = useDynamicContext();

  const handleLogout = async () => {
    sessionStorage.removeItem("admin_authenticated");
    try { await handleLogOut(); } catch { /* ignore */ }
    navigate("/");
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-xl font-bold tracking-tight text-foreground">
            erys<span className="text-primary">.</span>
          </Link>
          <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border border-destructive text-destructive rounded-none">
            Admin
          </span>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={handleLogout}
          className="rounded-none"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Logout
        </Button>
      </div>
    </nav>
  );
};

export default AdminNavbar;