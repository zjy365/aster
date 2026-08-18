import { download, site } from "@/lib/content";
import { releases, type Release } from "@/lib/releases";
import type { ReactNode } from "react";
import { Button, DownloadGlyph, ExternalGlyph } from "./button";
import { Section, SectionHead } from "./container";

const OS_ICONS: Record<Release["os"], ReactNode> = {
  macOS: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 12.54c-.03-2.89 2.36-4.27 2.47-4.34-1.35-1.97-3.44-2.24-4.18-2.27-1.78-.18-3.47 1.05-4.37 1.05-.9 0-2.29-1.02-3.77-1-1.94.03-3.72 1.13-4.72 2.86-2.01 3.49-.51 8.66 1.45 11.5.96 1.39 2.1 2.94 3.6 2.88 1.45-.06 2-.93 3.74-.93s2.25.93 3.77.9c1.56-.03 2.55-1.41 3.5-2.8 1.1-1.61 1.55-3.17 1.58-3.25-.04-.02-3.03-1.16-3.07-4.6zM14.36 4.06c.79-.96 1.33-2.3 1.18-3.63-1.14.05-2.53.76-3.35 1.72-.74.85-1.38 2.21-1.21 3.51 1.27.1 2.59-.64 3.38-1.6z" />
    </svg>
  ),
  Windows: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 5.5l8-1.1v7.1H3V5.5zM3 12.5h8v7.1l-8-1.1v-6zM12 4.3l9-1.3v8.5h-9V4.3zM12 12.5h9v8.5l-9-1.3v-7.2z" />
    </svg>
  ),
  Linux: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2c-2.2 0-4 1.9-4 4.3 0 1.5.5 2.8 1.2 3.9-.9.3-2 .9-2.7 1.9-.9-.5-1.9-.7-2.7-.4-.6.2-1 .8-.8 1.4.2.5.8.6 1.4.5-.2.3-.4.7-.4 1.1 0 .3.1.6.3.8-.6.4-1 1-1 1.7 0 .4.2.8.5 1 .4.3 1 .3 1.6.2.3.5.9.9 1.6 1 .4.1.7.1 1.1.1.6.3 1.3.5 2.1.5h1.2c.8 0 1.5-.2 2.1-.5.4 0 .7 0 1.1-.1.7-.1 1.3-.5 1.6-1 .6.1 1.2.1 1.6-.2.3-.2.5-.6.5-1 0-.7-.4-1.3-1-1.7.2-.2.3-.5.3-.8 0-.4-.2-.8-.4-1.1.6.1 1.2 0 1.4-.5.2-.6-.2-1.2-.8-1.4-.8-.3-1.8-.1-2.7.4-.7-1-1.8-1.6-2.7-1.9.7-1.1 1.2-2.4 1.2-3.9 0-2.4-1.8-4.3-4-4.3z" />
    </svg>
  ),
};

function UnreleasedCard() {
  return (
    <div className="reveal mx-auto flex max-w-[640px] flex-col items-center rounded-[20px] border border-hairline-soft bg-surface px-6 py-12 text-center sm:px-8 sm:py-14">
      <h3 className="text-[19px] font-[640] tracking-[-0.014em]">{download.unreleased.title}</h3>
      <p className="mt-3 max-w-[52ch] text-[14.5px] leading-[1.58] text-pretty text-ink-2">
        {download.unreleased.body}
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3.5">
        <Button href={site.repo} external glyph={<ExternalGlyph />}>
          {download.unreleased.primaryCta}
        </Button>
        <Button href={site.releasesUrl} variant="ghost" external glyph={<ExternalGlyph />}>
          {download.unreleased.secondaryCta}
        </Button>
      </div>
    </div>
  );
}

function DownloadGrid() {
  return (
    <div className="grid gap-4 sm:gap-5 lg:grid-cols-3">
      {releases.map((release) => (
        <div
          key={release.os}
          className={`reveal flex flex-col rounded-[20px] border px-7 py-8 transition-[transform,box-shadow,border-color] duration-[350ms] ease-(--ease-out) hover:-translate-y-[3px] hover:shadow-[0_2px_6px_rgb(0_0_0/0.04),0_20px_48px_rgb(30_25_20/0.08)] ${
            release.primary ? "border-ink bg-ink text-white" : "border-hairline-soft bg-surface"
          }`}
        >
          <div className="flex items-center gap-2.5 text-[20px] font-[640] tracking-[-0.015em]">
            {OS_ICONS[release.os]}
            {release.os}
          </div>
          <div className={`mt-1.5 font-mono text-[13px] ${release.primary ? "text-white/60" : "text-ink-2"}`}>
            {release.meta}
          </div>
          <Button
            href={release.href}
            variant={release.primary ? "onDark" : "ghost"}
            glyph={<DownloadGlyph />}
            className="mt-7"
            aria-label={`Download Aster for ${release.os}`}
          >
            Download for {release.os}
          </Button>
        </div>
      ))}
    </div>
  );
}

export function Download() {
  return (
    <Section id="download">
      <SectionHead title={download.head.title} body={download.head.body} />
      {releases.length === 0 ? <UnreleasedCard /> : <DownloadGrid />}
    </Section>
  );
}
