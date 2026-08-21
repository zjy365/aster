import type { ReactNode } from "react";

/**
 * The page's one horizontal rhythm. Every full-width band renders its content
 * through this so the gutters stay identical from the hero down to the footer.
 */
export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1160px] px-6 sm:px-8 lg:px-10 ${className}`}>{children}</div>;
}

export function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`py-16 sm:py-20 lg:py-24 ${className}`}>
      <Container>{children}</Container>
    </section>
  );
}

export function SectionHead({
  title,
  body,
  tone = "light",
}: {
  title: string;
  body?: string;
  tone?: "light" | "dark";
}) {
  return (
    <div className="reveal mx-auto mb-12 max-w-[42ch] text-center sm:mb-14 lg:mb-16">
      <h2
        className={`font-display text-[clamp(2rem,3.6vw,2.9rem)] leading-[1.12] font-medium tracking-[-0.022em] text-balance ${
          tone === "dark" ? "text-night-ink" : "text-ink"
        }`}
      >
        {title}
      </h2>
      {body ? (
        <p
          className={`mx-auto mt-4 max-w-[54ch] text-[16.5px] leading-[1.6] text-pretty ${
            tone === "dark" ? "text-night-ink-2" : "text-ink-2"
          }`}
        >
          {body}
        </p>
      ) : null}
    </div>
  );
}
