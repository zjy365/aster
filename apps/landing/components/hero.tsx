import { hero } from "@/lib/content";
import { Button, DownloadGlyph, ExternalGlyph } from "./button";
import { Container } from "./container";
import { WindowFrame } from "./window-frame";

export function Hero() {
  return (
    <header id="top" className="pt-32 pb-4 sm:pt-40 lg:pt-44">
      <Container className="text-center">
        <h1 className="mx-auto max-w-[15ch] font-display text-[clamp(2.6rem,6.2vw,5rem)] leading-[1.04] font-medium tracking-[-0.028em] text-balance">
          {hero.titleLine1}
          <br />
          {hero.titleLine2Before}
          <em className="text-brand-deep italic">{hero.titleLine2Em}</em>
          {hero.titleLine2After}
        </h1>

        <p className="mx-auto mt-6 max-w-[56ch] text-[17px] leading-[1.62] text-pretty text-ink-2 sm:text-[17.5px]">
          {hero.sub}
        </p>

        <div className="mt-9 flex flex-wrap justify-center gap-3.5">
          <Button href={hero.primaryCta.href} glyph={<DownloadGlyph />}>
            {hero.primaryCta.label}
          </Button>
          <Button href={hero.secondaryCta.href} variant="ghost" external glyph={<ExternalGlyph />}>
            {hero.secondaryCta.label}
          </Button>
        </div>

        <p className="mt-5 font-mono text-[12px] text-ink-3 sm:text-[12.5px]">{hero.note}</p>
      </Container>

      <Container className="mt-14 sm:mt-16 lg:mt-20">
        <WindowFrame title={hero.windowTitle} shot={hero.screenshot} priority />
      </Container>
    </header>
  );
}
