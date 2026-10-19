# Dual-Theme Token & Styling Guide

This guide defines the design token architecture and styling standards for Oddjob UI components. It documents how to write theme-neutral components that render consistently across both light and dark modes, satisfying the automated regression gate policed by `npm run lint:theme`.

---

## 1. Core Architectural Principle: Semantic Neutrality

Oddjob uses a semantic token layer mapped to Tailwind CSS variables. UI components should **never** hardcode opaque surface colors (such as `bg-white`, `bg-black`, `bg-slate-900`, or `text-white`) without a dual-theme variant.

Instead, every surface, border, and text element must derive its color from semantic tokens defined in the design system.

### Automated CI Gate: `npm run lint:theme`
The theme regression gate (`scripts/check-theme-surfaces.mjs`) scans all `.tsx` files in `client/src` and `server/domain`. Any un-exempted single-theme opaque classes cause a CI build failure.

---

## 2. Semantic Token Mapping Reference

When authoring or refactoring components, use this mapping table:

| Deprecated Hardcoded Pattern | Recommended Semantic Token | Usage Context |
| :--- | :--- | :--- |
| `bg-white`, `bg-slate-950`, `bg-slate-900` | `bg-card` | Cards, panels, modals, dropdown menus |
| `bg-slate-950` (page root) | `bg-background` | Top-level page wrappers, full-screen canvas |
| `bg-slate-800`, `bg-slate-100` | `bg-muted` | Badges, table headers, code snippet backdrops |
| `border-slate-800`, `border-slate-200` | `border-border` | Component outlines, table row dividers |
| `text-white`, `text-slate-950` | `text-foreground` | Primary headings, titles, active labels |
| `text-slate-400`, `text-slate-500` | `text-muted-foreground` | Secondary descriptions, timestamps, subtexts |
| `divide-slate-800`, `divide-slate-200` | `divide-border` | Table row dividing borders, list dividers |
| `hover:bg-slate-800` | `hover:bg-muted` | Interactive hover states on table rows or list items |

---

## 3. Accent Colors & Contrast Pairs

Buttons, highlights, and status badges frequently use saturated accent colors (`amber`, `emerald`, `indigo`, `cyan`, `violet`, `rose`). 

When applying accent colors, ensure the text foreground maintains sufficient contrast in **both** light and dark modes:

### Recommended Contrast Pairings

```tsx
// 1. Primary Action Button
<button className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md font-semibold">
  Submit Action
</button>

// 2. High-Visibility Amber / Critical Badge
<span className="bg-amber-500 text-amber-950 font-bold px-2 py-0.5 rounded text-xs">
  Critical
</span>

// 3. Success / Verification Badge
<span className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded text-xs">
  Verified
</span>

// 4. Subtle Ambient Card Header
<div className="border-b border-border bg-gradient-to-r from-violet-500/10 via-cyan-500/5 to-transparent p-4">
  <h3 className="text-foreground font-semibold">Workbench Header</h3>
</div>
```

---

## 4. Dual-Theme Variant Syntax

If a specific custom color is required that cannot use a standard token, you **must** supply both light and dark variants using Tailwind's `dark:` modifier:

```tsx
// Correct dual-theme styling
<div className="bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800">
  Content adjusts smoothly to both themes
</div>
```

---

## 5. Legitimate Single-Theme Exceptions

Certain surfaces are legitimately fixed to black or dark backgrounds regardless of the user's active theme:
1. **Video Player Letterboxing**: Media frames that must stay pitch black (`client/src/components/ui/video-player.tsx`).
2. **Modal Scrim Overlays**: Semi-transparent dark backdrops (`bg-black/60`). Note that semi-transparent overlays (`/10`, `/50`, `/80`) are automatically exempted by the linter.
3. **WebGL / Canvas / Terminal Workspaces**: Embedded terminal emulators or 3D tactical graphs.

### How to Mark Intentional Exceptions
To exempt an intentional single-theme surface from the regression gate:
1. **Inline Suppression**: Add `/* theme-lint-ignore */` on the matching line:
   ```tsx
   {/* theme-lint-ignore: terminal display requires fixed pitch-black backdrop */}
   <div className="bg-black text-emerald-400 font-mono p-4 rounded-lg">
     $ oddjob daemon start
   </div>
   ```
2. **File Allow-List**: For components where the entire element is dedicated to media playback, add the file path to `BG_BLACK_ALLOW` in [`scripts/check-theme-surfaces.mjs`](../../scripts/check-theme-surfaces.mjs).

---

## 6. Pre-Commit Verification Workflow

Before committing UI changes, verify theme compliance:

```bash
# 1. Run the theme surface regression gate
npm run lint:theme

# 2. Run the UI tokenization audit
npm run audit:ui-tokens
```
