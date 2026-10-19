/**
 * useDarkMode - Dark mode toggle hook
 *
 * Manages dark mode state with localStorage persistence and system preference detection.
 */

import { useState, useEffect, useCallback } from "react";

type Theme = "light" | "dark" | "system";

interface UseDarkModeReturn {
  isDark: boolean;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const STORAGE_KEY = "oddjob-theme-preference";

/**
 * Detect system dark mode preference
 */
function getSystemTheme(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Apply theme to DOM
 */
function applyTheme(isDark: boolean) {
  if (typeof document === "undefined") return;

  const html = document.documentElement;
  if (isDark) {
    html.classList.add("dark");
  } else {
    html.classList.remove("dark");
  }
}

export function useDarkMode(): UseDarkModeReturn {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "system";

    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      return stored || "system";
    } catch {
      return "system";
    }
  });

  const [isDark, setIsDark] = useState(() => {
    if (typeof window === "undefined") return false;

    if (theme === "system") {
      return getSystemTheme();
    }

    return theme === "dark";
  });

  // Handle theme changes
  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);

    // Save to localStorage
    try {
      localStorage.setItem(STORAGE_KEY, newTheme);
    } catch {
      // Ignore storage errors
    }

    // Apply theme
    if (newTheme === "system") {
      applyTheme(getSystemTheme());
      setIsDark(getSystemTheme());
    } else {
      applyTheme(newTheme === "dark");
      setIsDark(newTheme === "dark");
    }
  }, []);

  // Handle system preference changes
  useEffect(() => {
    if (theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = () => {
      const newIsDark = getSystemTheme();
      applyTheme(newIsDark);
      setIsDark(newIsDark);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return {
    isDark,
    theme,
    setTheme,
    toggle,
  };
}

export default useDarkMode;
