import { hero } from "@/lib/content";
import { AsterMark } from "./aster-mark";
import { Button, DownloadGlyph, ExternalGlyph } from "./button";
import { Container } from "./container";
import { WindowFrame } from "./window-frame";

/**
 * Brand-led opening, no nav bar: mark, name, the serif headline, one
 * paragraph, the two actions, then the product shot. The text column is
 * centered like a personal page; the window below runs the full measure.
 */
export function Hero() {
  return (
    <header id="top" className="pt-20 pb-4 sm:pt-28">
      <Container>
        <div className="reveal flex flex-col items-center text-center">
          <AsterMark size={84} animate />
          <p className="mt-7 text-[26px] font-semibold tracking-[-0.02em]">Aster</p>

          <h1 className="mx-auto mt-4 max-w-[16ch] font-display text-[clamp(2.6rem,6.2vw,5rem)] leading-[1.04] font-medium tracking-[-0.028em] text-balance">
            {hero.titleLine1}
            <br />
            {hero.titleLine2Before}
            <em className="text-brand-deep italic">{hero.titleLine2Em}</em>
            {hero.titleLine2After}
          </h1>

          <p className="mx-auto mt-6 max-w-[46ch] text-[17px] leading-[1.62] text-pretty text-ink-2 sm:text-[17.5px]">
            {hero.sub}
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3.5">
            <Button href={hero.primaryCta.href} glyph={<DownloadGlyph />}>
              {hero.primaryCta.label}
            </Button>
            <Button href={hero.secondaryCta.href} variant="ghost" external glyph={<ExternalGlyph />}>
              {hero.secondaryCta.label}
            </Button>
          </div>

          <p className="mt-5 font-mono text-[12px] text-ink-3 sm:text-[12.5px]">{hero.note}</p>
        </div>
      </Container>

      <Container className="mt-14 sm:mt-16 lg:mt-20">
        <WindowFrame title={hero.windowTitle} shot={hero.screenshot} priority />
      </Container>
    </header>
  );
}
