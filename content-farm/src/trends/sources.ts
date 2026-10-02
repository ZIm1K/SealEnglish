// Free, keyless (or free-key) trend feeds. Each source is optional: a failing feed is logged and
// skipped, the Claude web scan still runs.
import { secret } from "../env.ts";

export interface TrendSignal {
  source: string;
  title: string;
  detail?: string;
  traffic?: string;
  url?: string;
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : undefined;
};

/** Google Trends «Trending now» for a country (public RSS). */
export async function googleTrends(geo: string): Promise<TrendSignal[]> {
  const res = await fetch(`https://trends.google.com/trending/rss?geo=${geo}`, {
    headers: { "user-agent": "Mozilla/5.0 SealEnglishContentFarm" },
  });
  if (!res.ok) throw new Error(`Google Trends ${geo}: HTTP ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 25).map(([, item]) => ({
    source: `google_trends_${geo}`,
    title: tag(item, "title") ?? "",
    traffic: tag(item, "ht:approx_traffic"),
    detail: [...item.matchAll(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/g)]
      .slice(0, 2)
      .map(([, t]) => decode(t))
      .join(" | "),
  }));
}

/** YouTube «most popular» in a region — needs a free YouTube Data API key; skipped without it. */
export async function youtubePopular(region: string): Promise<TrendSignal[]> {
  const key = await secret("youtube");
  if (!key) return [];
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.search = new URLSearchParams({ part: "snippet,statistics", chart: "mostPopular", regionCode: region, maxResults: "25", key }).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube ${region}: HTTP ${res.status}`);
  const data = (await res.json()) as {
    items: { id: string; snippet: { title: string; channelTitle: string; tags?: string[] }; statistics: { viewCount?: string } }[];
  };
  return data.items.map((v) => ({
    source: `youtube_${region}`,
    title: v.snippet.title,
    detail: `${v.snippet.channelTitle}${v.snippet.tags?.length ? " · " + v.snippet.tags.slice(0, 5).join(", ") : ""}`,
    traffic: v.statistics.viewCount,
    url: `https://youtu.be/${v.id}`,
  }));
}

export async function collectSignals(log: (m: string) => void): Promise<TrendSignal[]> {
  const jobs: [string, () => Promise<TrendSignal[]>][] = [
    ["Google Trends UA", () => googleTrends("UA")],
    ["Google Trends US", () => googleTrends("US")],
    ["YouTube UA", () => youtubePopular("UA")],
  ];
  const out: TrendSignal[] = [];
  for (const [name, job] of jobs) {
    try {
      const got = await job();
      log(`  ${name}: ${got.length}`);
      out.push(...got);
    } catch (e) {
      log(`  ${name}: пропущено (${(e as Error).message})`);
    }
  }
  return out;
}
