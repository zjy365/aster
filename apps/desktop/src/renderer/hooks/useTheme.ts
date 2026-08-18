import { useEffect, useState } from "react";
import { buildThemeVariables, BUILT_IN_THEMES, DEFAULT_THEME_ID, getThemeDefinition } from "../../shared/themes";
import type { AppearanceTheme } from "../../shared/types";
import { desktop } from "../lib/desktop";

export type EffectiveTheme = "light" | "dark";

const THEME_STORAGE_KEY = "aster.theme";
const PALETTE_STORAGE_KEY = "aster.theme-palette";

/** Every variable a palette can set; the key set is identical for all themes. */
const THEME_VARIABLE_NAMES = Object.keys(buildThemeVariables(BUILT_IN_THEMES[0].light));

function readStoredTheme(): AppearanceTheme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function readStoredPalette(): string {
  const stored = localStorage.getItem(PALETTE_STORAGE_KEY);
  return getThemeDefinition(stored)?.id ?? DEFAULT_THEME_ID;
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Writes the palette's CSS variables onto <html>. The default theme removes
 * every override so the cascade falls back to the :root blocks in styles.css.
 */
function applyPalette(palette: string, mode: EffectiveTheme): void {
  const root = document.documentElement;
  root.dataset.palette = palette;
  for (const name of THEME_VARIABLE_NAMES) {
    root.style.removeProperty(name);
  }
  const definition = getThemeDefinition(palette);
  if (!definition || definition.id === DEFAULT_THEME_ID) return;
  const variables = buildThemeVariables(mode === "light" ? definition.light : definition.dark);
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }
}

/**
 * Startup FOUC guard: applies the stored scheme + palette synchronously before
 * the first React render, complementing the inline boot script in index.html
 * (which only has the neutral window colors).
 */
export function applyStoredTheme(): void {
  const theme = readStoredTheme();
  const mode: EffectiveTheme = theme === "dark" || (theme === "system" && systemPrefersDark()) ? "dark" : "light";
  document.documentElement.dataset.theme = mode;
  document.documentElement.classList.toggle("dark", mode === "dark");
  applyPalette(readStoredPalette(), mode);
}

/**
 * Owns the appearance preferences: localStorage persistence, the
 * prefers-color-scheme media listener, the document theme attributes the CSS
 * keys off, palette variable overrides, and the native window theme sync.
 */
export function useTheme(): {
  theme: AppearanceTheme;
  effectiveTheme: EffectiveTheme;
  palette: string;
  setTheme(theme: AppearanceTheme): void;
  setPalette(palette: string): void;
} {
  const [theme, setTheme] = useState<AppearanceTheme>(readStoredTheme);
  const [palette, setPalette] = useState<string>(readStoredPalette);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  const effectiveTheme: EffectiveTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    // Suppress color transitions while the whole variable surface flips.
    root.classList.add("no-transitions");
    root.dataset.theme = effectiveTheme;
    root.classList.toggle("dark", effectiveTheme === "dark");
    applyPalette(palette, effectiveTheme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    localStorage.setItem(PALETTE_STORAGE_KEY, palette);
    void desktop.appearance.setThemeSource(theme);
    void root.offsetWidth;
    const frame = requestAnimationFrame(() => root.classList.remove("no-transitions"));
    return () => cancelAnimationFrame(frame);
  }, [effectiveTheme, theme, palette]);

  return { theme, effectiveTheme, palette, setTheme, setPalette };
}
