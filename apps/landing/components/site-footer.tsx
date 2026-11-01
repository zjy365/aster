import { basePath, footer } from "@/lib/content";
import { AsterMark } from "./aster-mark";
import { Container } from "./container";
import { ThemeSwitcher } from "./theme-switcher";

export function SiteFooter() {
  return (
    <footer className="border-t border-hairline-soft py-10 lg:pt-16">
      <Container>
        <div className="flex flex-col gap-10 lg:flex-row lg:gap-16">
          <div className="min-w-0 lg:flex-1">
            <a
              href={`${basePath}/#top`}
              aria-label="Aster home"
              className="flex items-center gap-2.5 text-lg leading-6 font-semibold tracking-[-0.01em]"
            >
              <AsterMark size={24} />
              Aster
            </a>
            <p className="mt-4 max-w-[340px] text-sm leading-[23px] text-pretty text-ink-2">{footer.brand}</p>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-10 lg:grid-cols-[240px_120px_100px] lg:gap-x-16">
            {footer.columns.map((col) => (
              <nav key={col.title} aria-label={col.title} className="min-w-0 first:col-span-2 lg:first:col-span-1">
                <h2 className="mb-4 font-mono text-[11px] leading-6 font-medium tracking-[0.16em] text-ink-2 uppercase">
                  {col.title}
                </h2>
                <ul>
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href.startsWith("#") ? `${basePath}/${link.href}` : link.href}
                        {...(link.external ? { rel: "noopener noreferrer", target: "_blank" } : {})}
                        className={`flex min-h-11 items-center gap-2 py-2 text-sm leading-[22px] transition-colors duration-200 ease-(--ease-out) hover:text-ink hover:underline lg:min-h-8 lg:py-1 ${link.emphasis ? "text-primary" : "text-ink-2"}`}
                      >
                        {link.label}
                        {link.emphasis ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0" aria-hidden="true">
                            <path d="M5 12h14M13 6l6 6-6 6" />
                          </svg>
                        ) : null}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-12 border-t border-hairline-soft pt-6">
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-mono text-xs leading-5 text-ink-3">© 2026 Aster contributors · Apache-2.0</span>
            <ThemeSwitcher />
          </div>
          <p className="mt-5 text-xs leading-5 text-ink-3">Website only: self-hosted Rybbit measures visits and selected clicks using a browser visitor identifier. No raw IP storage or session replay. The desktop app has no analytics.</p>
        </div>
      </Container>
    </footer>
  );
}
