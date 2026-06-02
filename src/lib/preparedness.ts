export type PreparednessTier = "prepared" | "in_progress" | "none";

export interface PreparednessSource {
  hook?: string | null;
  profile_description?: string | null;
  category?: string | null;
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

export function getPreparednessScore(launch: PreparednessSource): number {
  let score = 0;
  if (launch.hook && launch.hook.trim()) score += 1;
  if (launch.profile_description && launch.profile_description.trim()) score += 1;
  if (launch.category && launch.category.trim()) score += 1;
  if (
    (launch.website_url && launch.website_url.trim()) ||
    (launch.twitter_handle && launch.twitter_handle.trim())
  ) {
    score += 1;
  }
  if (Array.isArray(launch.meme_images) && launch.meme_images.length >= 1) {
    score += 1;
  }
  const c = launch.launch_checklist;
  if (c && (c.memes_ready || c.posts_scheduled || c.community_notified)) {
    score += 1;
  }
  if (launch.launch_window && launch.launch_window.trim()) score += 1;
  return score;
}

export function getPreparednessTier(launch: PreparednessSource): PreparednessTier {
  const score = getPreparednessScore(launch);
  if (score >= 5) return "prepared";
  if (score >= 3) return "in_progress";
  return "none";
}