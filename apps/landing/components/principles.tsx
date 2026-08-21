import { principles } from "@/lib/content";
import { Container } from "./container";

export function Principles() {
  return (
    <div className="mt-10 sm:mt-12" role="region" aria-label="What Aster promises">
      <Container>
        <div className="reveal grid gap-px overflow-hidden rounded-[20px] border border-hairline-soft bg-hairline-soft sm:grid-cols-2 lg:grid-cols-4">
          {principles.map((principle) => (
            <div key={principle.title} className="bg-canvas px-6 py-7">
              <strong className="block text-[13.5px] font-semibold tracking-[-0.005em]">{principle.title}</strong>
              <span className="mt-1.5 block text-[13px] leading-[1.55] text-pretty text-ink-2">
                {principle.body}
              </span>
            </div>
          ))}
        </div>
      </Container>
    </div>
  );
}
