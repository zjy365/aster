import { Hero } from "@/components/hero";
import { SectionSeparator } from "@/components/section-separator";
import { Principles } from "@/components/principles";
import { FeatureBento } from "@/components/feature-bento";
import { Security } from "@/components/security";
import { Download } from "@/components/download";
import { Faq } from "@/components/faq";
import { SiteFooter } from "@/components/site-footer";
import { getReleases } from "@/lib/releases";
import type { Release } from "@/lib/releases";

export default async function Page() {
  // Fetched at build time (static export): the GitHub API is only called during
  // `next build`, never by visitors. Falls back to the "unreleased" card when
  // the API is unreachable or the release isn't cut yet.
  let releases: Release[] = [];
  try {
    ({ releases } = await getReleases());
  } catch {
    releases = [];
  }
  return (
    <>
      <main>
        <Hero />
        <SectionSeparator label="why aster" />
        <Principles />
        <FeatureBento />
        <Security />
        <Download releases={releases} />
        <SectionSeparator label="faq" />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
