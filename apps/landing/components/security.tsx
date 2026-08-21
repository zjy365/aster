import { security } from "@/lib/content";
import { Container, SectionHead } from "./container";

/**
 * The one diagram on the page. It is deliberately two boxes: the point is that
 * there is no third box, not how the app is wired internally.
 */
function TrustDiagram() {
  return (
    <div className="reveal my-12 sm:my-14">
      <div
        className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center sm:gap-0"
        aria-label={`${security.diagram.from} connects directly to ${security.diagram.to}`}
      >
        <div className="flex-1 rounded-[16px] border border-white/10 bg-night-2 px-6 py-5 text-center sm:max-w-[280px]">
          <span className="block text-[15px] font-semibold text-night-ink">{security.diagram.from}</span>
        </div>

        <span aria-hidden="true" className="flex items-center justify-center px-4 py-1 sm:py-0">
          <svg width="52" height="12" viewBox="0 0 52 12" fill="none" className="max-sm:rotate-90">
            <path
              d="M0 6h44M39 1.5L44.5 6 39 10.5"
              stroke="#e17b48"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>

        <div className="flex-1 rounded-[16px] border border-white/10 bg-night-2 px-6 py-5 text-center sm:max-w-[280px]">
          <span className="block text-[15px] font-semibold text-night-ink">{security.diagram.to}</span>
        </div>
      </div>

      <p className="mt-6 text-center font-mono text-[12.5px] text-night-ink-2">{security.diagram.caption}</p>
    </div>
  );
}

/*
 * The dark island: always night-colored, in both themes. On the light page it
 * is the one dark anchor; on the dark page it sits a step above the canvas,
 * like the raised surface in the app itself (DESIGN.md dark column).
 */
export function Security() {
  return (
    <section id={security.sectionId} className="py-4 sm:py-6">
      <Container>
        <div className="reveal rounded-[28px] border border-hairline-soft bg-night py-16 text-night-ink sm:py-20 lg:py-24">
          <div className="px-6 sm:px-10 lg:px-14">
            <SectionHead title={security.head.title} body={security.head.body} tone="dark" />

            <TrustDiagram />

            <div className="grid gap-px overflow-hidden rounded-[20px] border border-white/10 bg-white/10 lg:grid-cols-3">
              {security.items.map((item) => (
                <div key={item.title} className="bg-night px-7 py-7">
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
