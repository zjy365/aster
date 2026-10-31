import type { MetadataRoute } from "next";
import { articles } from "@/content/articles";
import { siteOrigin } from "@/lib/seo";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/blog/", ...articles.map(article => `/blog/${article.slug}/`)].map(path => ({ url: siteOrigin + path }));
}
