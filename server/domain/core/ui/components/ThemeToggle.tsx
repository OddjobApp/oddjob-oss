import { Moon, Sun } from 'lucide-react';
import { useTheme } from "@domain-ui/core/ui/hooks/useTheme";
import { LIGHT_MODE_ENABLED } from "@domain-ui/core/ui/components/theme-provider";

export function ThemeToggle() {
    const { mode, toggleTheme, isDark } = useTheme();

    // Hidden until light mode is token-conformant (see theme-provider).
    if (!LIGHT_MODE_ENABLED) return null;

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

