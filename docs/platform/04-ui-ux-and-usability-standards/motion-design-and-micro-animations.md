---
id: motion-design-and-micro-animations
title: "Micro-Animations, Transitions & Motion Design Standards"
audience: ["HUMAN_PRIMARY", "HYBRID"]
badge: "HYBRID"
category: "04-ui-ux-and-usability-standards"
autonomy_level: "L1-L3"
version: "1.0.0"
tags: ["ui-ux", "animation", "framer-motion", "micro-interactions", "transitions", "motion-tokens"]
summary: "Design standards for implementing subtle, high-performance micro-animations, physics-based springs, and layout transitions across Oddjob user interfaces."
---

# Micro-Animations & Motion Design Standards

> **Audience:** 🧑 Human / Builder | 🤝 Hybrid / Co-Pilot  
> **Autonomy Level:** L1 to L3  
> **Target Framework:** React / Tailwind CSS / Framer Motion

---

## 1. Core Principles of Oddjob Motion

Animations in Oddjob serve **functional feedback**, never decoration:
1. **Purposeful:** Every transition must communicate state change, spatial hierarchy, or completion.
2. **Snappy & Light:** Animations must feel instant ($< 300\text{ms}$) without delaying user actions.
3. **Hardware Accelerated:** Restrict animations to `transform` (`translate`, `scale`) and `opacity` to maintain 60 FPS without layout thrashing.
4. **Reduced Motion Respect:** Always honor the user's `prefers-reduced-motion` accessibility preferences.

---

## 2. Motion Duration & Easing Tokens

```css
:root {
  /* Durations */
  --duration-instant: 100ms;  /* Tooltips, button active state */
  --duration-fast: 150ms;     /* Hover states, dropdown toggles */
  --duration-normal: 250ms;   /* Modals, slide-over inspection drawers */
  --duration-slow: 400ms;     /* Page route transitions, complex graph layouts */

  /* Easing Curves */
  --ease-standard: cubic-bezier(0.4, 0.0, 0.2, 1);    /* Enter & Exit general */
  --ease-decelerate: cubic-bezier(0.0, 0.0, 0.2, 1);  /* Entering view elements */
  --ease-accelerate: cubic-bezier(0.4, 0.0, 1, 1);    /* Exiting view elements */
  --ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275); /* Subtle bounce */
}
```

---

## 3. Framer Motion Component Recipes

### A. Fluid Card Hover & Entrance
```tsx
import { motion } from "framer-motion";

export const StaggeredContainer = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

export const CardItem = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.0, 0.0, 0.2, 1] } },
};

export function OperationalCard({ title, value }: { title: string; value: string }) {
  return (
    <motion.div
      variants={CardItem}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      className="p-5 rounded-2xl bg-card border border-border/80 shadow-md hover:shadow-xl hover:border-primary/40 transition-colors"
    >
      <h4 className="text-xs font-semibold text-muted-foreground">{title}</h4>
      <p className="text-2xl font-black text-foreground mt-1">{value}</p>
    </motion.div>
  );
}
```

---

## 4. Modal & Drawer Slide-Over Choreography

```tsx
import { motion, AnimatePresence } from "framer-motion";

export function SlideOverDrawer({ isOpen, onClose, children }: any) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          />

          {/* Drawer Body */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-card border-l border-border z-50 p-6 shadow-2xl overflow-y-auto"
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
```
