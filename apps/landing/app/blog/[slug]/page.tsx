import { notFound } from "next/navigation";
import Link from "next/link";
import { articles } from "@/content/articles";
import { Container } from "@/components/container";
import { pageMetadata, siteOrigin } from "@/lib/seo";

export const dynamicParams = false;
export function generateStaticParams() { return articles.map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = articles.find(article => article.slug === slug);
  if (!article) notFound();
  return pageMetadata(article.title, article.description, `/blog/${slug}/`);
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = articles.find(article => article.slug === slug);
  if (!article) notFound();
  const url = `${siteOrigin}/blog/${slug}/`;
  const data = { "@context": "https://schema.org", "@graph": [
    { "@type": "TechArticle", headline: article.title, description: article.description, url, inLanguage: "en", author: { "@type": "Organization", name: "Aster contributors", url: siteOrigin } },
    { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Aster", item: siteOrigin + "/" },
      { "@type": "ListItem", position: 2, name: "Kubernetes guides", item: siteOrigin + "/blog/" },
      { "@type": "ListItem", position: 3, name: article.title, item: url },
    ] },
  ] };
  return <Container className="py-10 sm:py-16">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />
    <nav aria-label="Breadcrumb" className="mb-9 text-sm text-ink-2"><Link href="/">Aster</Link> / <Link href="/blog/">Kubernetes guides</Link></nav>
    <article className="reading-article">
      <header><h1>{article.title}</h1><p className="reading-intro">{article.introduction}</p></header>
      <nav aria-label="On this page"><h2>In this guide</h2><ul>{article.sections.map(section => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ul></nav>
      {article.sections.map(section => <section key={section.id} aria-labelledby={section.id}><h2 id={section.id}>{section.title}</h2>{section.body}</section>)}
      <aside className="reading-related"><h2>Continue reading</h2><ul>{article.related.map(slug => {
        const related = articles.find(article => article.slug === slug)!;
        return <li key={slug}><Link href={`/blog/${slug}/`}>{related.title}</Link></li>;
      })}</ul><p><Link href="/#download">Download Aster</Link> or <Link href="/blog/">browse all Kubernetes guides</Link>.</p></aside>
    </article>
  </Container>;
}
