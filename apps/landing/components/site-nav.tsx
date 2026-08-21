import { nav } from "@/lib/content";
import { Button, DownloadGlyph } from "./button";

export function AsterMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 86 88" fill="currentColor" aria-hidden="true" className="text-brand">
      <rect x="33.25" y="0" width="19.5" height="88" />
      <rect x="33.25" y="0" width="19.5" height="88" transform="rotate(60 43 44)" />
      <rect x="33.25" y="0" width="19.5" height="88" transform="rotate(-60 43 44)" />
    </svg>
  );
}

export function SiteNav() {
  return (
    <div className="fixed inset-x-0 top-4 z-100 flex justify-center px-4">
      <nav
        aria-label="Main"
        className="flex max-w-full items-center gap-4 rounded-full border border-hairline-soft py-2 pr-2.5 pl-5 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_32px_rgb(0_0_0/0.10)] backdrop-blur-[20px] backdrop-saturate-150 sm:gap-7"
        style={{ background: "var(--nav-bg)" }}
      >
        <a
          href="#top"
          aria-label="Aster home"
          className="flex flex-none items-center gap-[9px] text-[15px] font-semibold tracking-[-0.01em]"
        >
          <AsterMark />
          Aster
        </a>

        <div className="hidden items-center gap-6 md:flex">
          {nav.links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              {...(link.external ? { rel: "noopener noreferrer", target: "_blank" } : {})}
              className="text-[13px] font-medium whitespace-nowrap text-ink-2 transition-colors duration-200 ease-(--ease-out) hover:text-ink"
            >
              {link.label}
            </a>
          ))}
        </div>

        <Button href="#download" size="sm" glyph={<DownloadGlyph />} className="flex-none">
          {nav.download}
        </Button>
      </nav>
    </div>
  );
}
