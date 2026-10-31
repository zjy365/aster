import Link from "next/link";
import { articles } from "@/content/articles";
import { Container } from "@/components/container";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("Kubernetes GUI guides and client comparisons", "Choose a Kubernetes desktop client, inspect pod logs and connect local development clusters. Practical guides with Aster’s capabilities and limits explained.", "/blog/");

export default function BlogIndex() {
  return <Container className="py-16 sm:py-20">
    <h1 className="max-w-3xl font-display text-4xl leading-tight sm:text-5xl">Kubernetes GUI guides and comparisons</h1>
    <p className="mt-5 max-w-2xl text-ink-2">Start with the task: choosing a client, understanding a workload, or connecting a development cluster. These guides include the limits as well as the useful parts.</p>
    <div className="mt-12 grid gap-x-10 md:grid-cols-2">{articles.map(article => <article key={article.slug} className="border-t border-hairline py-7">
      <h2 className="text-xl font-semibold"><Link href={`/blog/${article.slug}/`} className="hover:underline">{article.title}</Link></h2>
      <p className="mt-3 text-ink-2">{article.description}</p>
    </article>)}</div>
  </Container>;
}
