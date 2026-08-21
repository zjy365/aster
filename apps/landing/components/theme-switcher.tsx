"use client";

import { useEffect, useState } from "react";

type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "aster-theme";

const MODES: { id: ThemeMode; label: string; icon: React.ReactNode }[] = [
  {
    id: "system",
    label: "System",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M9 20h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "light",
    label: "Light",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "dark",
    label: "Dark",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

function applyMode(mode: ThemeMode) {
  const root = document.documentElement;
  root.classList.toggle("light", mode === "light");
  root.classList.toggle("dark", mode === "dark");
}

/**
 * The page's one piece of client JavaScript: a three-way appearance switch
 * (system / light / dark), persisted to localStorage. Server-rendered with no
 * active state; the stored choice is read after mount so hydration stays clean.
 * The pre-paint half of this logic is the inline script in app/layout.tsx.
 */
export function ThemeSwitcher() {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") setMode(stored);
    setMounted(true);
  }, []);

  const choose = (next: ThemeMode) => {
    setMode(next);
    applyMode(next);
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  };

  return (
    <div
      role="group"
      aria-label="Appearance"
      className="flex items-center gap-0.5 rounded-full bg-chip p-[3px]"
    >
      {MODES.map(({ id, label, icon }) => {
        const active = mounted && mode === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            aria-label={`${label} appearance`}
            title={label}
            onClick={() => choose(id)}
            className={`flex h-[26px] w-[26px] items-center justify-center rounded-full transition-[background-color,color,box-shadow] duration-200 ease-(--ease-out) ${
              active
                ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_var(--hairline-soft)]"
                : "text-ink-3 hover:text-ink-2"
            }`}
          >
            {icon}
          </button>
        );
      })}
    </div>
  );
}
