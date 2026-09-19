import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const siteUrl = "https://aster.zjy365.dev";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
