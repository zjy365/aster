// SPDX-License-Identifier: Apache-2.0
/**
 * Color palette themes. A theme is a pair of light/dark color sets over a
 * small semantic role set; `buildThemeVariables` fans the roles out into the
 * full CSS variable surface (app layer + shadcn layer) at apply time, so
 * switching themes never touches stylesheets — only inline custom properties
 * on <html>.
 *
 * The default theme ("aster") mirrors the :root / dark blocks in styles.css
 * exactly; if those change, update the values here — they feed the settings
 * preview orbs. The boot script in index.html independently mirrors the
 * neutral --window values for first-paint background color.
 */

export type ThemeMode = "light" | "dark";

export interface ThemeColors {
  window: string;
  sidebar: string;
  surface: string;
  surfaceMuted: string;
  surfaceHover: string;
  /** Raised surfaces: popovers, cards, dialogs. */
  surfaceRaised: string;
  text: string;
  textSecondary: string;
  faint: string;
  border: string;
  borderStrong: string;
  brand: string;
  accentSoft: string;
  accentText: string;
  focus: string;
}

export interface ThemeDefinition {
  id: string;
  label: string;
  light: ThemeColors;
  dark: ThemeColors;
}

export const DEFAULT_THEME_ID = "aster";

const LIGHT_NEUTRALS = {
  window: "#f5f5f7",
  sidebar: "#efeff1",
  surface: "#ffffff",
  surfaceMuted: "#f6f6f7",
  surfaceHover: "#ededf0",
  surfaceRaised: "#ffffff",
  text: "#1d1d1f",
  textSecondary: "#66666b",
  faint: "#68686d",
  border: "rgb(60 60 67 / 18%)",
  borderStrong: "rgb(60 60 67 / 28%)",
} as const;

const DARK_NEUTRALS = {
  window: "#1c1c1e",
  sidebar: "#232326",
  surface: "#1c1c1e",
  surfaceMuted: "#252528",
  surfaceHover: "#303034",
  surfaceRaised: "#2c2c2e",
  text: "#f5f5f7",
  textSecondary: "#aeaeb2",
  faint: "#8e8e93",
  border: "rgb(84 84 88 / 55%)",
  borderStrong: "rgb(99 99 102 / 75%)",
} as const;

/** Translucent brand tint, matching the alpha levels styles.css uses (10% light / 14% dark). */
const soft = (hex: string, percent: number) => `color-mix(in srgb, ${hex} ${percent}%, transparent)`;

export const BUILT_IN_THEMES: ThemeDefinition[] = [
  {
    id: "aster",
    label: "Aster",
    light: {
      ...LIGHT_NEUTRALS,
      brand: "#c65f2d",
      accentSoft: soft("#c65f2d", 10),
      accentText: "#88401f",
      focus: "#007aff",
    },
    dark: {
      ...DARK_NEUTRALS,
      brand: "#e17b48",
      accentSoft: soft("#e17b48", 14),
      accentText: "#ffab7d",
      focus: "#0a84ff",
    },
  },
  {
    id: "ocean",
    label: "Ocean",
    light: {
      ...LIGHT_NEUTRALS,
      brand: "#0e6fb8",
      accentSoft: soft("#0e6fb8", 10),
      accentText: "#0a4e85",
      focus: "#0e6fb8",
    },
    dark: {
      ...DARK_NEUTRALS,
      brand: "#4ba3ec",
      accentSoft: soft("#4ba3ec", 14),
      accentText: "#a8d4f8",
      focus: "#4ba3ec",
    },
  },
  {
    id: "grove",
    label: "Grove",
    light: {
      ...LIGHT_NEUTRALS,
      brand: "#0f7e66",
      accentSoft: soft("#0f7e66", 10),
      accentText: "#0a5746",
      focus: "#0f7e66",
    },
    dark: {
      ...DARK_NEUTRALS,
      brand: "#3dbb97",
      accentSoft: soft("#3dbb97", 14),
      accentText: "#8fe0c4",
      focus: "#3dbb97",
    },
  },
  {
    id: "iris",
    label: "Iris",
    light: {
      ...LIGHT_NEUTRALS,
      brand: "#6a4fd0",
      accentSoft: soft("#6a4fd0", 10),
      accentText: "#4b33a8",
      focus: "#6a4fd0",
    },
    dark: {
      ...DARK_NEUTRALS,
      brand: "#a08ef2",
      accentSoft: soft("#a08ef2", 14),
      accentText: "#cdc2fb",
      focus: "#a08ef2",
    },
  },
  {
    id: "graphite",
    label: "Graphite",
    light: {
      ...LIGHT_NEUTRALS,
      brand: "#505056",
      accentSoft: soft("#505056", 10),
      accentText: "#34343a",
      focus: "#007aff",
    },
    dark: {
      ...DARK_NEUTRALS,
      brand: "#a2a2a8",
      accentSoft: soft("#a2a2a8", 14),
      accentText: "#d6d6da",
      focus: "#0a84ff",
    },
  },
];

export function getThemeDefinition(id: string | null | undefined): ThemeDefinition | undefined {
  return BUILT_IN_THEMES.find((theme) => theme.id === id);
}

/**
 * Fans the semantic roles out into every CSS variable the app and the shadcn
 * layer read. Not applied for the default theme — the :root blocks in
 * styles.css already carry these exact values, and staying on the cascade
 * keeps the default pixel-identical.
 */
export function buildThemeVariables(colors: ThemeColors): Record<string, string> {
  return {
    "--window": colors.window,
    "--sidebar": colors.sidebar,
    "--surface": colors.surface,
    "--surface-muted": colors.surfaceMuted,
    "--surface-hover": colors.surfaceHover,
    "--surface-raised": colors.surfaceRaised,
    "--text": colors.text,
    "--text-secondary": colors.textSecondary,
    "--faint": colors.faint,
    "--border": colors.border,
    "--border-strong": colors.borderStrong,
    "--brand": colors.brand,
    "--accent-soft": colors.accentSoft,
    "--accent-text": colors.accentText,
    "--focus": colors.focus,
    "--background": colors.surface,
    "--foreground": colors.text,
    "--popover": colors.surfaceRaised,
    "--popover-foreground": colors.text,
    "--card": colors.surfaceRaised,
    "--card-foreground": colors.text,
    "--primary": colors.focus,
    "--primary-foreground": "#ffffff",
    "--secondary": colors.surfaceHover,
    "--secondary-foreground": colors.text,
    "--muted": colors.surfaceMuted,
    "--muted-foreground": colors.textSecondary,
    "--accent": colors.surfaceHover,
    "--accent-foreground": colors.text,
    "--input": colors.border,
    "--ring": colors.focus,
    "--sidebar-foreground": colors.text,
    "--sidebar-primary": colors.focus,
    "--sidebar-accent": colors.accentSoft,
    "--sidebar-accent-foreground": colors.accentText,
    "--sidebar-border": colors.border,
    "--sidebar-ring": colors.focus,
  };
}

/**
 * Background for a theme preview orb: two soft color glows over a faintly
 * tinted base, all computed in oklab so blends stay perceptually even. The
 * CSS side adds blur + scale so the glow edges melt together; keep this
 * standalone (no var() refs) so it renders the same regardless of the
 * currently applied theme. Light/dark mirror the glow centers so the two
 * orbs read as two sides of one palette.
 */
export function themeOrbBackground(colors: ThemeColors, mode: ThemeMode): string {
  const base = `color-mix(in oklab, ${colors.surface} 80%, ${mode === "light" ? "#ffffff" : "#09090b"})`;
  const accentCenter = mode === "light" ? "72% 22%" : "28% 78%";
  const brandCenter = mode === "light" ? "18% 82%" : "82% 18%";
  return [
    `radial-gradient(circle at ${accentCenter}, ${colors.focus} 0%, transparent 62%)`,
    `radial-gradient(circle at ${brandCenter}, ${colors.brand} 0%, transparent 70%)`,
    base,
  ].join(", ");
}

/**
 * Tiny palette for the appearance wireframe thumbnails — the window chrome,
 * a sidebar rail, a toolbar, and a resource row, enough to read light/dark
 * at a glance. Keyed off the semantic roles so it follows the palette.
 */
export interface ThemeWireframeColors {
  canvas: string;
  sidebar: string;
  sidebarActive: string;
  toolbar: string;
  toolbarAction: string;
  row: string;
  rowHighlight: string;
}

export function themeWireframeColors(colors: ThemeColors): ThemeWireframeColors {
  return {
    canvas: colors.window,
    sidebar: colors.sidebar,
    sidebarActive: colors.accentSoft,
    toolbar: colors.surface,
    toolbarAction: colors.focus,
    row: colors.surface,
    rowHighlight: colors.accentSoft,
  };
}
