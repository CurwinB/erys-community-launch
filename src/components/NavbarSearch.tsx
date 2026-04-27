import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface SearchResult {
  id: string;
  token_name: string;
  token_symbol: string;
  image_url: string | null;
  status: string;
  platform: string | null;
}

const NavbarSearch = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce input
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Close on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const { data: results, isLoading } = useQuery({
    queryKey: ["navbar-search", debounced],
    enabled: debounced.length > 0,
    queryFn: async () => {
      const term = debounced.replace(/[%_]/g, "");
      const { data, error } = await supabase
        .from("launches_public")
        .select("id, token_name, token_symbol, image_url, status, platform")
        .or(`token_symbol.ilike.%${term}%,token_name.ilike.%${term}%`)
        .limit(8);
      if (error) throw error;
      return (data || []) as SearchResult[];
    },
  });

  const handleSelect = (id: string) => {
    setOpen(false);
    setQuery("");
    navigate(`/launch/${id}`);
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-xs">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => query && setOpen(true)}
          placeholder="Search by symbol or name…"
          className="h-9 w-full rounded-sm border border-border bg-card pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && debounced.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-y-auto border border-border bg-card shadow-xl">
          {isLoading ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">Searching…</div>
          ) : results && results.length > 0 ? (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => handleSelect(r.id)}
                className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/50"
              >
                <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-sm bg-muted">
                  {r.image_url && (
                    <img
                      src={r.image_url}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {r.token_symbol}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {r.token_name}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span>{r.status}</span>
                    {r.platform && <span>· {r.platform}</span>}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="px-3 py-4 text-xs text-muted-foreground">No matches.</div>
          )}
        </div>
      )}
    </div>
  );
};

export default NavbarSearch;