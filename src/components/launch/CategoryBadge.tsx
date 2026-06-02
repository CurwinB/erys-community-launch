interface Props {
  category?: string | null;
  size?: "sm" | "md";
  className?: string;
}

const LABELS: Record<string, string> = {
  meme: "Meme",
  community: "Community",
  tech: "Tech",
  other: "Other",
};

const TONES: Record<string, string> = {
  meme: "border-pink-500/40 bg-pink-500/10 text-pink-400",
  community: "border-primary/40 bg-primary/10 text-primary",
  tech: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  other: "border-border bg-muted text-muted-foreground",
};

const CategoryBadge = ({ category, size = "md", className = "" }: Props) => {
  if (!category || !LABELS[category]) return null;
  const sizing =
    size === "sm" ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]";
  return (
    <span
      className={`inline-flex items-center rounded-sm border font-semibold uppercase tracking-wider ${TONES[category]} ${sizing} ${className}`}
    >
      {LABELS[category]}
    </span>
  );
};

export default CategoryBadge;