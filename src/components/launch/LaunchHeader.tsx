import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/StatusBadge";
import { ExternalLink } from "lucide-react";

interface LaunchHeaderProps {
  launch: {
    image_url: string | null;
    token_name: string;
    token_symbol: string;
    status: string;
    description: string | null;
    twitter_url: string | null;
    telegram_url: string | null;
    website_url: string | null;
    platform?: string | null;
  };
}

const LaunchHeader = ({ launch }: LaunchHeaderProps) => (
  <section className="border-b border-border bg-card">
    <div className="container mx-auto flex flex-col gap-6 px-4 py-8 md:flex-row md:items-center">
      <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-sm bg-muted">
        {launch.image_url ? (
          <img src={launch.image_url} alt={launch.token_name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-muted-foreground">
            {launch.token_symbol.charAt(0)}
          </div>
        )}
      </div>
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground md:text-3xl">{launch.token_name}</h1>
          <span className="font-mono text-sm text-muted-foreground">${launch.token_symbol}</span>
          <StatusBadge status={launch.status as any} />
          {launch.platform === "pumpfun" ? (
            <span className="rounded-sm border border-[#00FF88]/30 bg-[#00FF88]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#00FF88]">
              Pump.fun
            </span>
          ) : (
            <span className="rounded-sm border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              Bags.fm
            </span>
          )}
        </div>
        {launch.description && (
          <p className="mt-2 text-sm text-muted-foreground">{launch.description}</p>
        )}
        <div className="mt-3 flex gap-2">
          {[launch.twitter_url, launch.telegram_url, launch.website_url]
            .filter(Boolean)
            .map((url) => (
              <a key={url} href={url!} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="icon" className="h-8 w-8">
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </a>
            ))}
        </div>
      </div>
    </div>
  </section>
);

export default LaunchHeader;
