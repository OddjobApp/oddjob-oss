import { useState, useEffect } from 'react';
import { lightTheme, darkTheme, ThemeMode, Theme } from '@/styles/themes';

const THEME_STORAGE_KEY = 'oddjob-theme';

export function useTheme() {
    // Initialize theme from localStorage or system preference
    const [mode, setMode] = useState<ThemeMode>(() => {
        const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
        if (stored) return stored;

        // Check system preference
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    });

    const [theme, setTheme] = useState<Theme>(mode === 'dark' ? darkTheme : lightTheme);

    // Update theme when mode changes
    useEffect(() => {
        const newTheme = mode === 'dark' ? darkTheme : lightTheme;
        setTheme(newTheme);

        // Apply theme to document
        document.documentElement.setAttribute('data-theme', mode);

        // Apply CSS variables
        Object.entries(newTheme).forEach(([key, value]) => {
            document.documentElement.style.setProperty(`--color-${key}`, value as string);
        });

        // Save to localStorage
        localStorage.setItem(THEME_STORAGE_KEY, mode);
    }, [mode]);

    // Listen for system theme changes
    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        const handleChange = (e: MediaQueryListEvent) => {
            // Only auto-switch if user hasn't manually set a preference
            const stored = localStorage.getItem(THEME_STORAGE_KEY);
            if (!stored) {
                setMode(e.matches ? 'dark' : 'light');
            }
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, []);

    const toggleTheme = () => {
        setMode((prev: ThemeMode) => prev === 'light' ? 'dark' : 'light');
    };

    return {
        mode,
        theme,
        setMode,
        toggleTheme,
        isDark: mode === 'dark',
    };
}
