import { security } from "@/lib/content";
import { Container, SectionHead } from "./container";

/**
 * The one diagram on the page, drawn as a sentence rather than a chart: two
 * names and an arrow, with nothing in between. The missing middle box is the
 * argument, so the rendering carries no furniture the caption has to excuse.
 */
function TrustDiagram() {
  return (
    <div className="reveal my-14 text-center sm:my-16">
      <p
        className="font-display text-[clamp(1.7rem,3.6vw,2.5rem)] leading-[1.2] tracking-[-0.01em] text-night-ink"
        aria-label={`${security.diagram.from} connects directly to ${security.diagram.to}`}
      >
        {security.diagram.from}
        <svg
          aria-hidden="true"
          viewBox="0 0 40 12"
          fill="none"
          className="mx-[0.55em] inline-block h-[0.42em] w-auto -translate-y-[0.08em]"
        >
          <path
            d="M0 6h32M27 1.5L32.5 6 27 10.5"
            stroke="#e17b48"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {security.diagram.to}
      </p>
      <p className="mt-5 font-mono text-[12.5px] text-night-ink-2">{security.diagram.caption}</p>
    </div>
  );
}

/*
 * The dark island: always night-colored, in both themes. On the light page it
 * is the one dark anchor; on the dark page it lifts to the app's raised
 * surface with a hairline of top light, like the workbench itself (DESIGN.md
 * dark column).
 */
export function Security() {
  return (
    <section id={security.sectionId} className="py-4 sm:py-6">
      <Container>
        <div className="reveal rounded-[28px] border border-hairline-soft bg-night py-16 text-night-ink sm:py-20 lg:py-24 [.dark_&]:bg-surface-muted [.dark_&]:shadow-[inset_0_1px_0_rgb(255_255_255/6%)]">
          <div className="px-6 sm:px-10 lg:px-14">
            <SectionHead title={security.head.title} body={security.head.body} tone="dark" />

            <TrustDiagram />

            <div className="grid gap-px overflow-hidden rounded-[20px] border border-white/10 bg-white/10 lg:grid-cols-3">
              {security.items.map((item) => (
                <div key={item.title} className="bg-night px-7 py-7 [.dark_&]:bg-surface">
                  <h3 className="text-[15px] font-semibold tracking-[-0.008em] text-night-ink">{item.title}</h3>
                  <p className="mt-2 text-[13.5px] leading-[1.6] text-pretty text-night-ink-2">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
