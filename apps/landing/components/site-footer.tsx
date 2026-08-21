import { footer } from "@/lib/content";
import { AsterMark } from "./aster-mark";
import { Container } from "./container";
import { ThemeSwitcher } from "./theme-switcher";

export function SiteFooter() {
  return (
    <footer className="border-t border-hairline-soft pt-12 pb-14">
      <Container>
        <div className="flex flex-wrap items-start justify-between gap-10">
          <div className="max-w-[340px]">
            <a
              href="#top"
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
                    href={link.href}
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
        </div>
      </Container>
    </footer>
  );
}
