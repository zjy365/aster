import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const siteUrl = "https://zjy365.github.io/aster";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${siteUrl}/`, lastModified: new Date() }];
}
