import { createContext, useContext, useEffect, useState } from "react"

type Theme = "dark" | "light" | "system" | "indigo"

type ThemeProviderProps = {
    children: React.ReactNode
    defaultTheme?: Theme
    storageKey?: string
}

type ThemeProviderState = {
    theme: Theme
    setTheme: (theme: Theme) => void
}

const initialState: ThemeProviderState = {
    theme: "system",
    setTheme: () => null,
}

// Light mode is re-enabled: the semantic-token pass (increments 1-6) made page
// content token-conformant, verified in light on Operations, Insights, Knowledge,
// Pipelines/Workstreams, App Arsenal, and the 404. The default theme stays "dark"
// (see CoreProviders), so light is opt-in via the header toggle — nothing changes
// for existing users unless they switch. Set back to false to re-gate if a deep
// page regresses in light.
export const LIGHT_MODE_ENABLED = true;

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
    children,
    defaultTheme = "system",
    storageKey = "vite-ui-theme",
}: ThemeProviderProps) {
    const [theme, setTheme] = useState<Theme>(
        () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
    )

    useEffect(() => {
        const root = window.document.documentElement

        root.classList.remove("light", "dark", "indigo")

        if (!LIGHT_MODE_ENABLED) {
            // Locked to dark until light mode is token-conformant.
            root.classList.add("dark")
            return
        }

        if (theme === "system") {
            const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
                .matches
                ? "dark"
                : "light"

            root.classList.add(systemTheme)
            return
        }

        root.classList.add(theme)
    }, [theme])

    const value = {
        theme,
        setTheme: (theme: Theme) => {
            localStorage.setItem(storageKey, theme)
            setTheme(theme)
        },
    }

    return (
        <ThemeProviderContext.Provider {...{ value }}>
            {children}
        </ThemeProviderContext.Provider>
    )
}

export const useTheme = () => {
    const context = useContext(ThemeProviderContext)

    if (context === undefined)
        throw new Error("useTheme must be used within a ThemeProvider")

    return context
}
