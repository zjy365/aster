import { faq } from "@/lib/content";
import { Section, SectionHead } from "./container";

export function Faq() {
  return (
    <Section id="faq">
      <SectionHead title="Questions, answered plainly." />
      <div className="reveal max-w-[760px]">
        {faq.map((item) => (
          <details key={item.q} className="group border-b border-hairline">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[16px] font-medium tracking-[-0.01em] transition-colors duration-200 ease-(--ease-out) hover:text-brand-deep sm:py-6 sm:text-[16.5px] [&::-webkit-details-marker]:hidden">
              {item.q}
              <span
                aria-hidden="true"
                className="inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full border border-hairline text-[15px] font-normal text-ink-2 transition-[transform,background-color,color,border-color] duration-300 ease-(--ease-out) group-open:rotate-45 group-open:border-transparent group-open:bg-brand-soft group-open:text-brand-deep"
              >
                +
              </span>
            </summary>
            <div className="max-w-[64ch] pb-6 text-[15px] leading-[1.65] text-pretty text-ink-2">{item.a}</div>
          </details>
        ))}
      </div>
    </Section>
  );
}
