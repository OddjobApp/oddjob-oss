import { Moon, Sun } from 'lucide-react';
import { useTheme } from "@domain-ui/core/ui/hooks/useTheme";

export function ThemeToggle() {
    const { mode, toggleTheme, isDark } = useTheme();

    return (
        <button
            onClick={toggleTheme}
            className="theme-toggle"
            aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        >
            {isDark ? (
                <Sun className="w-5 h-5" />
            ) : (
                <Moon className="w-5 h-5" />
            )}
        </button>
    );
}

