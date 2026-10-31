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
import Link from "next/link";
import { articles } from "@/content/articles";
import { Container } from "@/components/container";
import { site } from "@/lib/content";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("Free Open-Source Kubernetes GUI Desktop Client", site.description, "/");

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
        <section className="py-16 sm:py-20" aria-labelledby="guides-title"><Container>
          <h2 id="guides-title" className="font-display text-3xl sm:text-4xl">Choose your next Kubernetes workflow</h2>
          <p className="mt-4 max-w-2xl text-ink-2">Compare clients, connect a development cluster, or get more context while reading logs.</p>
          <div className="mt-8 grid gap-x-10 md:grid-cols-2">{articles.map(article => <article key={article.slug} className="border-t border-hairline py-5">
            <h3 className="font-semibold"><Link className="hover:underline" href={`/blog/${article.slug}/`}>{article.title}</Link></h3>
            <p className="mt-2 text-sm text-ink-2">{article.description}</p>
          </article>)}</div>
          <Link className="mt-5 inline-block text-primary underline" href="/blog/">Browse all Kubernetes guides →</Link>
        </Container></section>
        <SectionSeparator label="faq" />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
