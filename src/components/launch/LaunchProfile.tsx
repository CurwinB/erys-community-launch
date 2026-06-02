import { ExternalLink, Check, Clock } from "lucide-react";

interface LaunchProfileData {
  profile_description?: string | null;
  website_url?: string | null;
  twitter_handle?: string | null;
  meme_images?: string[] | null;
  launch_checklist?: {
    memes_ready?: boolean | null;
    posts_scheduled?: boolean | null;
    community_notified?: boolean | null;
  } | null;
  launch_window?: string | null;
}

const LaunchProfile = ({ launch }: { launch: LaunchProfileData }) => {
  const description = launch.profile_description?.trim() || null;
  const website = launch.website_url?.trim() || null;
  const twitter = launch.twitter_handle?.trim() || null;
  const memes = (launch.meme_images || []).filter((u) => !!u);
  const checklist = launch.launch_checklist || {};
  const window = launch.launch_window?.trim() || null;

  const checklistItems: Array<{ key: string; label: string; on: boolean }> = [
    { key: "memes_ready", label: "Memes ready", on: !!checklist.memes_ready },
    { key: "posts_scheduled", label: "Posts scheduled", on: !!checklist.posts_scheduled },
    { key: "community_notified", label: "Community notified", on: !!checklist.community_notified },
  ].filter((i) => i.on);

  const hasSignals = checklistItems.length > 0 || !!window;

  if (!description && !website && !twitter && memes.length === 0 && !hasSignals) {
    return null;
  }

  const twitterUrl = twitter
    ? `https://x.com/${twitter.replace(/^@/, "")}`
    : null;

  return (
    <div className="space-y-4">
      {(description || website || twitter) && (
        <div className="border border-border bg-card p-5 space-y-3">
          {description && (
            <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
              {description}
            </p>
          )}
          {(website || twitter) && (
            <div className="flex flex-wrap items-center gap-2">
              {website && (
                <a
                  href={website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:border-primary/40 hover:text-primary transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span className="truncate max-w-[220px]">
                    {website.replace(/^https?:\/\//, "")}
                  </span>
                </a>
              )}
              {twitter && twitterUrl && (
                <a
                  href={twitterUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:border-primary/40 hover:text-primary transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true">
                    <path d="M18.244 2H21.5l-7.5 8.57L23 22h-6.844l-5.36-7.01L4.5 22H1.244l8.03-9.18L1 2h6.99l4.84 6.4L18.244 2zm-1.2 18h1.86L7.04 4H5.07l11.974 16z" />
                  </svg>
                  @{twitter.replace(/^@/, "")}
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {memes.length > 0 && (
        <div className="border border-border bg-card p-4">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Memes
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {memes.map((url, idx) => (
              <a
                key={`${url}-${idx}`}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 border border-border hover:border-primary/40 transition-colors"
              >
                <img
                  src={url}
                  alt={`Meme ${idx + 1}`}
                  loading="lazy"
                  className="h-32 w-32 object-cover sm:h-40 sm:w-40"
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {hasSignals && (
        <div className="border border-border bg-card p-4">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Launch signals
          </div>
          <div className="space-y-2">
            {checklistItems.map((item) => (
              <div key={item.key} className="flex items-center gap-2 text-xs text-foreground">
                <Check className="h-3.5 w-3.5 text-success" />
                {item.label}
              </div>
            ))}
            {window && (
              <div className="flex items-center gap-2 text-xs text-foreground">
                <Clock className="h-3.5 w-3.5 text-primary" />
                <span className="text-muted-foreground">Launch window:</span>
                <span>{window}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LaunchProfile;