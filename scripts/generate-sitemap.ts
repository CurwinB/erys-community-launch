// Runs before `vite dev` and `vite build`; writes public/sitemap.xml.
// Pulls active launches from Supabase so dynamic /launch/:id routes are indexed.

import { writeFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = "https://erys.live";
const SUPABASE_URL = "https://cifdozolzbztuohtdavx.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpZmRvem9semJ6dHVvaHRkYXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MDAzODMsImV4cCI6MjA5MTM3NjM4M30.2g-chNVNPqoj5ZQUCAlTniSlKgKPCEqZ7gRK5nLCyCk";

interface SitemapEntry {
  path: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

const staticEntries: SitemapEntry[] = [
  { path: "/", changefreq: "daily", priority: "1.0" },
  { path: "/schedule", changefreq: "hourly", priority: "0.9" },
  { path: "/contact", changefreq: "monthly", priority: "0.4" },
  { path: "/terms", changefreq: "monthly", priority: "0.3" },
  { path: "/privacy", changefreq: "monthly", priority: "0.3" },
  { path: "/risk", changefreq: "monthly", priority: "0.3" },
];

async function fetchLaunchEntries(): Promise<SitemapEntry[]> {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await supabase
      .from("launches_public")
      .select("id, created_at")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) {
      console.warn(`[sitemap] launches fetch failed: ${error.message}`);
      return [];
    }
    return (data ?? []).map((row: any) => ({
      path: `/launch/${row.id}`,
      lastmod: (row.created_at ?? "").slice(0, 10) || undefined,
      changefreq: "hourly" as const,
      priority: "0.7",
    }));
  } catch (err: any) {
    console.warn(`[sitemap] launches fetch threw: ${err?.message ?? err}`);
    return [];
  }
}

function generateSitemap(entries: SitemapEntry[]): string {
  const urls = entries.map((e) =>
    [
      `  <url>`,
      `    <loc>${BASE_URL}${e.path}</loc>`,
      e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
      e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
      e.priority ? `    <priority>${e.priority}</priority>` : null,
      `  </url>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
  ].join("\n");
}

async function main() {
  const launchEntries = await fetchLaunchEntries();
  const entries = [...staticEntries, ...launchEntries];
  writeFileSync(resolve("public/sitemap.xml"), generateSitemap(entries));
  console.log(`sitemap.xml written (${entries.length} entries: ${staticEntries.length} static + ${launchEntries.length} launches)`);
}

main().catch((err) => {
  console.error("[sitemap] fatal:", err);
  process.exit(0); // never block dev/build on sitemap errors
});