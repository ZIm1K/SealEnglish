import type { MetadataRoute } from "next";
import { SITE } from "@/content/site";

export const dynamic = "force-static";

const LANGS = { uk: `${SITE.url}/`, en: `${SITE.url}/en/` };

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE.url}/`, changeFrequency: "weekly", priority: 1, alternates: { languages: LANGS } },
    { url: `${SITE.url}/en/`, changeFrequency: "monthly", priority: 0.8, alternates: { languages: LANGS } },
    { url: `${SITE.url}/test/`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE.url}/login/`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE.url}/offer/`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE.url}/privacy/`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
