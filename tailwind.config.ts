import type { Config } from "tailwindcss";
import { colors as dsColors } from "./packages/design-system/src/tokens.js";

export default {
  darkMode: ["class"],
  content: [
    "./client/index.html",
    "./client/src/**/*.{js,jsx,ts,tsx}",
    "./server/domain/**/ui/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      /**
       * A named stacking order, because the numbers were an argument.
       *
       * The codebase had z-10/20/30/40/50, then four separate things at z-[100],
       * then z-[99999] and z-[100000] on the tutorial — nobody picks 100000
       * except to win. Four components sharing z-[100] means their real order is
       * a source-order accident, which is how a decorative overlay ends up
       * swallowing clicks meant for the control underneath it.
       *
       * The gaps are deliberate: 10 between tiers leaves room to slot something
       * in without renumbering its neighbours. Use the name that describes what
       * the thing IS, and if two things collide, that is a design question about
       * which should win, not a licence to add a digit.
       */
      zIndex: {
        /** Raised within a component: sticky headers, floating ribbons. */
        raised: "10",
        /** Site furniture that outranks page content but not a dialog. */
        chrome: "50",
        /** Floating actions that outrank chrome/rails but sit beneath modals. */
        floating: "60",
        /** The dimmed backdrop behind a modal. */
        overlay: "70",
        /** Dialogs, sheets, command palettes. Above their own overlay. */
        modal: "80",
        /**
         * Anchored to a control: dropdowns, selects, popovers.
         *
         * Above modal deliberately. Radix portals popper content to the body,
         * so a select opened inside a dialog renders as a sibling of it — which
         * is why three SelectContents had been pushed to z-[100] and z-[110],
         * each escalating past the last. A popover only exists while the user is
         * operating its trigger, and that trigger may be inside a dialog, so
         * outranking one is the correct answer rather than a workaround.
         */
        popover: "85",
        /** Transient feedback. Must clear a modal to be readable during one. */
        toast: "90",
        /** Coach marks that point AT the UI, so they sit above all of it. */
        tutorial: "100",
      },
      borderRadius: {
        lg: "1.5rem", /* 24px */
        md: "1rem", /* 16px */
        sm: "0.5rem", /* 8px */
      },
      boxShadow: {
        soft: "0 10px 40px -10px rgba(0,0,0,0.08)",
      },
      colors: {
        // Design System Semantic Scales
        success: dsColors.success,
        danger: dsColors.danger,
        warning: dsColors.warning,
        info: dsColors.info,
        recovery: dsColors.recovery,
        execution: dsColors.execution,
        manual: dsColors.manual,
        neutral: dsColors.neutral,

        // Cinematic Theme Colors (Aliased to standard theme colors for backwards compatibility)
        "accent-tan": "#A68D7B",
        "bg-tan": "#FDFCF7",
        "card-cream": "#FDFCF7",
        "espresso": "#2D241E",
        "sidebar-tan": "#F2EFE9",
        "vibrant-bronze": "#CD7F32",
        "bronze-muted": "#8C735B",
        // Flat / base colors (regular buttons)
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
          border: "hsl(var(--card-border) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
          border: "hsl(var(--popover-border) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          border: "var(--primary-border)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
          border: "var(--secondary-border)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
          border: "var(--muted-border)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
          border: "var(--accent-border)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          border: "var(--destructive-border)",
        },
        ring: "hsl(var(--ring) / <alpha-value>)",
        chart: {
          "1": "hsl(var(--chart-1) / <alpha-value>)",
          "2": "hsl(var(--chart-2) / <alpha-value>)",
          "3": "hsl(var(--chart-3) / <alpha-value>)",
          "4": "hsl(var(--chart-4) / <alpha-value>)",
          "5": "hsl(var(--chart-5) / <alpha-value>)",
        },
        sidebar: {
          ring: "hsl(var(--sidebar-ring) / <alpha-value>)",
          DEFAULT: "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
        },
        "sidebar-primary": {
          DEFAULT: "hsl(var(--sidebar-primary) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          border: "var(--sidebar-primary-border)",
        },
        "sidebar-accent": {
          DEFAULT: "hsl(var(--sidebar-accent) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "var(--sidebar-accent-border)"
        },
        status: {
          online: "rgb(34 197 94)",
          away: "rgb(245 158 11)",
          busy: "rgb(239 68 68)",
          offline: "rgb(156 163 175)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
        heading: ["var(--font-heading)"],
      },

      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.3s ease-in-out",
        "slide-up": "slide-up 0.4s ease-out",
        "scale-in": "scale-in 0.2s ease-out",
        "float": "float 6s ease-in-out infinite",
        "shimmer": "shimmer 2.5s linear infinite",
      },
      keyframes: {
        "float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "shimmer": {
          "100%": { transform: "translateX(100%)" },
        },
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-up": {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "scale-in": {
          "0%": { transform: "scale(0.95)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
