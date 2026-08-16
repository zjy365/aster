import { useCallback, useEffect, useState } from "react";
import type { AppearanceTheme } from "../../shared/types";
import { desktop } from "../lib/desktop";

export type EffectiveTheme = "light" | "dark";

/**
 * Owns the appearance preference: localStorage persistence, the
 * prefers-color-scheme media listener, the document theme attributes the CSS
 * keys off, and the Electron nativeTheme sync.
 */
export function useTheme(): {
  theme: AppearanceTheme;
  effectiveTheme: EffectiveTheme;
  setTheme(theme: AppearanceTheme): void;
  cycleTheme(): void;
} {
  const [theme, setTheme] = useState<AppearanceTheme>(() => {
    const stored = localStorage.getItem("aster.theme");
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  const effectiveTheme: EffectiveTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
    document.documentElement.classList.toggle("dark", effectiveTheme === "dark");
    localStorage.setItem("aster.theme", theme);
    void desktop.appearance.setThemeSource(theme);
  }, [effectiveTheme, theme]);

  // Cycle system → light → dark → system so the "follow system" preference is
  // never silently discarded by a single toggle click.
  const cycleTheme = useCallback(() => {
    setTheme((current) => (current === "system" ? "light" : current === "light" ? "dark" : "system"));
  }, []);

  return { theme, effectiveTheme, setTheme, cycleTheme };
}
