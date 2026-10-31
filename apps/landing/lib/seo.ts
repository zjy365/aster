import type { Metadata } from "next";

export const siteOrigin = "https://aster.zjy365.dev";

export function pageMetadata(title: string, description: string, path: string): Metadata {
  const fullTitle = `${title} | Aster`;
  const url = siteOrigin + path;
  const image = { url: `${siteOrigin}/opengraph-image`, width: 1200, height: 630, alt: "Aster: a local Kubernetes desktop GUI" };
  return {
    title: { absolute: fullTitle },
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", locale: "en_US", siteName: "Aster", title: fullTitle, description, url, images: [image] },
    twitter: { card: "summary_large_image", title: fullTitle, description, images: [image.url] },
  };
}
