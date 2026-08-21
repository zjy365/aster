import type { ReactNode } from "react";

/** Trailing glyph inside a button's circular badge. */
export function DownloadGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M6 1v7M3 5.5L6 8.5l3-3M1.5 10.5h9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ExternalGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M2 10L10 2M4 2h6v6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const BASE =
  "group inline-flex cursor-pointer items-center justify-center gap-2.5 rounded-full font-medium " +
  "transition-[transform,background-color,border-color,box-shadow,opacity] duration-200 ease-(--ease-out) active:scale-[0.97]";

/*
 * The solid button is the ink/canvas inversion: near-black on the light page,
 * near-white on the dark page. There is no accent-colored button anywhere on
 * the site — blue stays on focus rings, orange stays on the brand.
 */
const VARIANTS = {
  solid: "bg-ink text-canvas hover:opacity-[0.88]",
  ghost: "bg-chip text-ink hover:bg-chip-hover",
  onDark: "bg-night-ink text-night hover:opacity-[0.88]",
  ghostOnDark: "bg-white/8 text-night-ink hover:bg-white/14",
} as const;

const SIZES = {
  md: "px-[22px] py-3 text-[14px]",
  sm: "px-4 py-2 text-[13px]",
} as const;

const BADGES = {
  solid: "bg-on-ink-badge",
  ghost: "bg-brand-soft text-brand-deep",
  onDark: "bg-brand-soft text-brand-deep",
  ghostOnDark: "bg-white/12",
} as const;

export function Button({
  href,
  children,
  glyph,
  variant = "solid",
  size = "md",
  external = false,
  className = "",
  ...rest
}: {
  href: string;
  children: ReactNode;
  glyph?: ReactNode;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  external?: boolean;
  className?: string;
} & { "aria-label"?: string }) {
  return (
    <a
      href={href}
      {...(external ? { rel: "noopener noreferrer", target: "_blank" } : {})}
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {children}
      {glyph ? (
        <span
          aria-hidden="true"
          className={`inline-flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full transition-transform duration-[250ms] ease-(--ease-out) group-hover:translate-x-[2px] group-hover:-translate-y-px ${BADGES[variant]}`}
        >
          {glyph}
        </span>
      ) : null}
    </a>
  );
}
