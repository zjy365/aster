import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const siteUrl = "https://zjy365.github.io/aster";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
