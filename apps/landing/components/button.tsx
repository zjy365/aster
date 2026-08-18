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
  "group inline-flex cursor-pointer items-center justify-center gap-2.5 rounded-full font-[550] " +
  "transition-[transform,background-color,border-color,box-shadow] duration-200 ease-(--ease-out) active:scale-[0.97]";

const VARIANTS = {
  solid:
    "bg-ink text-white shadow-[0_1px_2px_rgb(0_0_0/0.12),0_4px_14px_rgb(0_0_0/0.10)] " +
    "hover:bg-[#333336] hover:shadow-[0_2px_4px_rgb(0_0_0/0.14),0_8px_24px_rgb(0_0_0/0.14)]",
  ghost:
    "border border-hairline bg-transparent text-ink hover:border-[rgb(60_60_67/0.28)] hover:bg-surface",
  onDark: "bg-white text-ink hover:bg-[#ececee]",
  ghostOnDark: "border border-white/16 bg-transparent text-dark-ink hover:border-white/28 hover:bg-white/6",
} as const;

const SIZES = {
  md: "px-[22px] py-3 text-[14.5px]",
  sm: "px-4 py-2 text-[13.5px]",
} as const;

const BADGES = {
  solid: "bg-white/16",
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
