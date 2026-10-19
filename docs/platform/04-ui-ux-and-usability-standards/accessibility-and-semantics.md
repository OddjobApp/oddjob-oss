---
id: accessibility-and-semantics
title: WCAG 2.1 AA Accessibility & Semantic Markup Standards
audience: [AGENT_PRIMARY, HUMAN_PRIMARY]
badge: HYBRID
category: 04-ui-ux-and-usability-standards
autonomy_level: L0-L4
version: 1.0.0
tags: [accessibility, a11y, wcag, aria, semantics, keyboard-navigation]
summary: Mandatory accessibility standards including WCAG 2.1 AA color contrast, ARIA labels, semantic landmark elements, and keyboard focus management.
---

# Accessibility & Semantic HTML Standards `[🤝 HYBRID]`

> **Audience:** `🤝 Hybrid: Builder + Agent` &nbsp;|&nbsp; **Compliance Level:** `WCAG 2.1 AA Mandatory`

---

## 1. Accessibility Invariants for Agents `[🤖 Agent Checklist]`
When generating or refactoring frontend JSX/HTML:
1. **Interactive Elements:** Every clickable `<div>` or custom card must either be a `<button>` or have `role="button"`, `tabIndex={0}`, and an `onKeyDown` handler for `Enter` and `Space`.
2. **Icon-Only Buttons:** Every `<Button size="icon">` must declare an `aria-label` or `title` prop describing its exact action (e.g. `aria-label="Refresh telemetry stream"`).
3. **Contrast Ratios:** Text must have a minimum contrast ratio of `4.5:1` against its background (`7:1` for small text).
4. **Form Inputs:** Every `<Input>` must have an associated `<Label>` or explicit `aria-labelledby`.

---

## 2. Semantic Landmark Hierarchy `[🤖 Agent]`
```html
<main className="max-w-7xl mx-auto w-full p-6">
  <header className="flex justify-between items-center pb-6">
    <h1>Mission Command</h1>
  </header>
  
  <section aria-labelledby="metrics-title">
    <h2 id="metrics-title" className="sr-only">Key Performance Indicators</h2>
    <!-- Metric Cards -->
  </section>
</main>
```
