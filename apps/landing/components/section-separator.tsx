import { Container } from "./container";

/**
 * Hairline rule with a mono uppercase label, used at the page's major joints.
 * Purely structural: it names the section that follows.
 */
export function SectionSeparator({ label }: { label: string }) {
  return (
    <Container className="mt-20 sm:mt-24 lg:mt-28">
      <div className="flex items-center gap-4" aria-hidden="true">
        <span className="h-px flex-1 bg-hairline-soft" />
        <span className="font-mono text-[11px] tracking-[0.18em] text-ink-3 uppercase">{label}</span>
        <span className="h-px flex-1 bg-hairline-soft" />
      </div>
    </Container>
  );
}
