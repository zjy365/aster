import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const siteUrl = "https://aster.zjy365.dev";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${siteUrl}/`, lastModified: new Date() }];
}
