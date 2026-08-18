import Image from "next/image";
import { asset, features, hero, type FeatureCard } from "@/lib/content";
import { Section, SectionHead } from "./container";
import { DiffBlock } from "./diff-block";

const CARD =
  "reveal group flex h-full flex-col overflow-hidden rounded-[20px] border border-hairline-soft bg-surface " +
  "transition-[transform,box-shadow] duration-[350ms] ease-(--ease-out) " +
  "hover:-translate-y-[3px] hover:shadow-[0_2px_6px_rgb(0_0_0/0.04),0_20px_48px_rgb(30_25_20/0.08)]";

type Shot = { src: string; alt: string; width: number; height: number };

function CardCopy({ card }: { card: FeatureCard }) {
  return (
    <>
      <h3 className="text-[18px] leading-[1.25] font-[640] tracking-[-0.014em] text-balance sm:text-[19px]">
        {card.title}
      </h3>
      <p className="mt-2.5 max-w-[48ch] text-[14.5px] leading-[1.58] text-pretty text-ink-2">{card.body}</p>
    </>
  );
}

/**
 * A screenshot that bleeds off the card's right and bottom edges, so the card
 * reads as a window onto the app rather than a framed thumbnail.
 */
function CardShot({ shot, focus }: { shot: Shot; focus: string }) {
  return (
    <div className="mt-auto overflow-hidden pt-3 pl-7 sm:pl-8">
      <div className="overflow-hidden rounded-tl-[16px] border-t border-l border-hairline-soft bg-surface-muted">
        <Image
          src={asset(shot.src)}
          alt={shot.alt}
          width={shot.width}
          height={shot.height}
          sizes="(max-width: 1024px) 100vw, 640px"
          className={`h-[280px] w-full object-cover ${focus} transition-transform duration-[600ms] ease-(--ease-out) group-hover:scale-[1.015]`}
        />
      </div>
    </div>
  );
}

function Card({ card }: { card: FeatureCard }) {
  // The dry-run card owns a full row: copy on the left, the diff beside it.
  // Stacking it would leave a tall void next to the short text cards.
  if (card.media === "diff") {
    return (
      <article className={`col-span-12 ${card.span} ${CARD} lg:flex-row lg:items-center`}>
        <div className="px-7 pt-7 pb-2 sm:px-8 lg:w-[42%] lg:flex-none lg:py-10">
          <CardCopy card={card} />
        </div>
        <div className="w-full lg:py-8 lg:pr-8">
          <DiffBlock />
        </div>
      </article>
    );
  }

  return (
    <article className={`col-span-12 ${card.span} ${CARD}`}>
      <div className="px-7 pt-7 pb-6 sm:px-8">
        <CardCopy card={card} />
      </div>

      {/* Framed below the window toolbar: the table is the story, the chrome is not. */}
      {card.media === "resources" ? <CardShot shot={hero.screenshot} focus="object-[0%_38%]" /> : null}
      {card.media === "palette" ? <CardShot shot={hero.palette} focus="object-[18%_40%]" /> : null}

      {card.hint ? (
        <div className="mt-auto border-t border-hairline-soft px-7 py-4 sm:px-8">
          <span className="flex items-center gap-2 font-mono text-[12.5px] text-ink-3">
            <kbd>⌘K</kbd> to jump anywhere
          </span>
        </div>
      ) : null}
    </article>
  );
}

export function FeatureBento() {
  return (
    <Section id="features">
      <SectionHead title={features.head.title} body={features.head.body} />
      <div className="grid grid-cols-12 gap-4 sm:gap-5">
        {features.cards.map((card) => (
          <Card key={card.title} card={card} />
        ))}
      </div>
    </Section>
  );
}
