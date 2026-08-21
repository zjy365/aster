/** Aster brand mark: six-spoke asterisk, filled, flat caps. Mirrors the app icon (src-tauri/icons/icon.svg). */
export function AsterMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 86 88"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="33.25" y="0" width="19.5" height="88" />
      <rect x="33.25" y="0" width="19.5" height="88" transform="rotate(60 43 44)" />
      <rect x="33.25" y="0" width="19.5" height="88" transform="rotate(-60 43 44)" />
    </svg>
  );
}
