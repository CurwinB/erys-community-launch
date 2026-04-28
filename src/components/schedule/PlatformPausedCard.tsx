import { Button } from "@/components/ui/button";

type Platform = "bags" | "pumpfun";

interface Props {
  platform: Platform;
  otherEnabled: boolean;
  onSwitch: () => void;
}

const COPY: Record<Platform, { name: string; accent: string; other: string }> = {
  bags: { name: "Bags.fm", accent: "#00D4FF", other: "Pump.fun" },
  pumpfun: { name: "Pump.fun", accent: "#00FF88", other: "Bags.fm" },
};

const PlatformPausedCard = ({ platform, otherEnabled, onSwitch }: Props) => {
  const { name, accent, other } = COPY[platform];

  return (
    <div
      className="mt-8 border border-border bg-card p-8"
      style={{ boxShadow: `0 0 0 1px ${accent}1a inset` }}
    >
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        <span className="relative inline-flex h-2 w-2">
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
            style={{ backgroundColor: accent }}
          />
          <span
            className="relative inline-flex h-2 w-2 rounded-full"
            style={{ backgroundColor: accent }}
          />
        </span>
        Maintenance in progress
      </div>

      <h2 className="mt-4 text-2xl font-bold text-foreground">
        {name} launches are temporarily paused
      </h2>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        We're upgrading our {name} integration to deliver a smoother, more
        reliable launch experience. New {name} launches are paused for a short
        window while we ship improvements. Existing launches and contributions
        are unaffected.
      </p>

      {otherEnabled ? (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {other} launches remain fully open — switch above to launch now, or
          check back shortly.
        </p>
      ) : (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Please check back in a little while. Thanks for your patience.
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        {otherEnabled && (
          <Button
            type="button"
            onClick={onSwitch}
            className="rounded-sm"
            style={{ backgroundColor: accent, color: "#0A0A0A" }}
          >
            Switch to {other}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="rounded-sm"
          onClick={() => window.location.reload()}
        >
          Refresh status
        </Button>
      </div>
    </div>
  );
};

export default PlatformPausedCard;