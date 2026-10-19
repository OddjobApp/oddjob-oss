export const THEME = {
    colors: {
        primary: "#4B3D33",
        accentTan: "#A68D7B",
        bgTan: "hsl(35, 30%, 96%)",
        cardCream: "#FDFCF7",
        espresso: "#2D241E",
        sidebarTan: "#F2EFE9",
        obsidian: "hsl(222.2, 84%, 4.9%)",
        deepCharcoal: "hsl(25, 10%, 12%)",
        vibrantBronze: "#CD7F32",
        bronzeMuted: "#8C735B",
    },
    glass: {
        base: "backdrop-blur-xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-black/40",
        header: "backdrop-blur-3xl border border-white/20 dark:border-white/5 bg-white/60 dark:bg-black/80 shadow-2xl",
        sidebar: "backdrop-blur-3xl border-r border-white/10 dark:border-white/5 bg-white/40 dark:bg-black/60 shadow-2xl",
    },
    shadows: {
        floating: "shadow-[0_20px_50px_rgba(0,0,0,0.1)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)]",
        glow: "shadow-[0_0_20px_rgba(205,127,50,0.3)]",
    },
    animations: {
        float: "animate-float",
        shimmer: "animate-shimmer",
    }
};

export const combineClasses = (...classes: string[]) => classes.filter(Boolean).join(' ');
