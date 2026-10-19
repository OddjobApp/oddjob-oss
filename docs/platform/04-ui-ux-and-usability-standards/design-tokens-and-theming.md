---
id: design-tokens-and-theming
title: UI Design Tokens, Theming & Aesthetic Standards
audience: [AGENT_PRIMARY, HUMAN_PRIMARY]
badge: HYBRID
category: 04-ui-ux-and-usability-standards
autonomy_level: L0-L4
version: 1.0.0
tags: [design-system, tokens, css, dark-mode, typography, aesthetics]
summary: Mandatory visual rules and design tokens for agents and developers generating frontend interfaces and Forged Apps.
---

# UI Design Tokens & Aesthetic Standards `[🤝 HYBRID]`

> **Audience:** `🤝 Hybrid: Builder + Agent` &nbsp;|&nbsp; **Classification:** UI/UX Education

---

## 1. Absolute Styling Invariants `[🤖 Agent]`
When generating or modifying React/HTML/CSS views:
* **Never use raw hex colors:** Strictly forbidden: `#000000`, `#ffffff`, `#ff0000`.
* **Always use semantic CSS custom properties:**
  * Backgrounds: `hsl(var(--background))`, `hsl(var(--card))`
  * Surfaces & Borders: `hsl(var(--border))`, `var(--surface-raised)`
  * Accents & Statuses: `var(--accent-primary)`, `hsl(var(--success))`
* **Card Elevation Standards:** Every card container must have rounded corners (`rounded-xl` / `0.75rem`), subtle translucent borders (`border border-foreground/10`), and dark backdrop blur.

---

## 2. Token Dictionary `[🤖 Agent Reference]`

```json
{
  "theme": {
    "colors": {
      "primary": "hsl(215, 90%, 56%)",
      "surface": "hsl(220, 18%, 12%)",
      "surfaceRaised": "hsl(220, 18%, 16%)",
      "borderSubtle": "hsl(220, 14%, 22%)",
      "textPrimary": "hsl(220, 20%, 96%)",
      "textMuted": "hsl(220, 10%, 65%)"
    },
    "typography": {
      "display": "Outfit, system-ui, sans-serif",
      "body": "Inter, system-ui, sans-serif",
      "code": "JetBrains Mono, monospace"
    }
  }
}
```
