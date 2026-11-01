import Link from "next/link";
import { articles } from "@/content/articles";
import { footer } from "@/lib/content";
import { AsterMark } from "./aster-mark";
import { Container } from "./container";
import { ThemeSwitcher } from "./theme-switcher";
import { basePath } from "@/lib/content";

export function SiteFooter() {
  return (
    <footer className="border-t border-hairline-soft pt-12 pb-14">
      <Container>
        <nav aria-labelledby="footer-guides-title" className="mb-10 border-b border-hairline-soft pb-10">
          <h2 id="footer-guides-title" className="font-display text-2xl sm:text-3xl">
            Choose your next Kubernetes workflow
          </h2>
          <p className="mt-3 max-w-2xl text-sm text-ink-2">
            Compare clients, connect a development cluster, or get more context while reading logs.
          </p>
          <ul className="mt-5 grid gap-x-10 gap-y-1 md:grid-cols-2">
            {articles.map((article) => (
              <li key={article.slug}>
                <Link
                  className="block py-2 text-sm text-ink-2 hover:text-ink hover:underline"
                  href={`/blog/${article.slug}/`}
                >
                  {article.title}
                </Link>
              </li>
            ))}
          </ul>
          <Link className="mt-4 inline-block py-1 text-sm text-primary underline" href="/blog/">
            Browse all Kubernetes guides →
          </Link>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-10">
          <div className="max-w-[340px]">
            <a
              href={`${basePath}/#top`}
              aria-label="Aster home"
              className="flex items-center gap-[9px] text-[15px] font-semibold tracking-[-0.01em]"
            >
              <AsterMark />
              Aster
            </a>
            <p className="mt-3 text-[13.5px] leading-[1.6] text-pretty text-ink-2">{footer.brand}</p>
          </div>

          <div className="flex gap-12 sm:gap-14">
            {footer.columns.map((col) => (
              <div key={col.title}>
                <strong className="mb-3.5 block font-mono text-[11px] font-medium tracking-[0.18em] text-ink-3 uppercase">
                  {col.title}
                </strong>
                {col.links.map((link) => (
                  <a
                    key={link.label}
                    href={link.href.startsWith("#") ? `${basePath}/${link.href}` : link.href}
                    {...(link.external ? { rel: "noopener noreferrer", target: "_blank" } : {})}
                    className="block py-1 text-[14px] text-ink-2 transition-colors duration-200 ease-(--ease-out) hover:text-ink"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-11 flex flex-wrap items-center justify-between gap-3 border-t border-hairline-soft pt-5">
          <span className="font-mono text-[12.5px] text-ink-3">© 2026 Aster contributors · Apache-2.0</span>
          <ThemeSwitcher />
          <p className="w-full text-[12px] text-ink-3">Website only: self-hosted Rybbit measures visits and selected clicks using a browser visitor identifier. No raw IP storage or session replay. The desktop app has no analytics.</p>
        </div>
      </Container>
    </footer>
  );
}
