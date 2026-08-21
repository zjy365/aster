/**
 * The brand asterisk: three bars crossing at 60° intervals. With `animate`,
 * the bars rotate into place one after another on first paint, like the mark
 * being drawn, and hovering turns the whole mark a sixth of a revolution —
 * which lands on the identical shape, so the spin is seamless. Transform-only;
 * fully still under prefers-reduced-motion (see globals.css).
 */
export function AsterMark({ size = 20, animate = false }: { size?: number; animate?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 86 88"
      fill="currentColor"
      aria-hidden="true"
      className={`text-brand ${animate ? "aster-mark" : ""}`}
    >
      <rect x="33.25" y="0" width="19.5" height="88" className="aster-bar" style={{ "--angle": "0deg" } as React.CSSProperties} />
      <rect x="33.25" y="0" width="19.5" height="88" className="aster-bar" style={{ "--angle": "60deg" } as React.CSSProperties} />
      <rect x="33.25" y="0" width="19.5" height="88" className="aster-bar" style={{ "--angle": "-60deg" } as React.CSSProperties} />
    </svg>
  );
}
