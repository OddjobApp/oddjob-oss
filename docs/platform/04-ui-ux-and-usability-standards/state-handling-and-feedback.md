---
id: state-handling-and-feedback
title: The 4-State UI & Usability Heuristics
audience: [AGENT_PRIMARY, HUMAN_PRIMARY]
badge: AGENT_PRIMARY
category: 04-ui-ux-and-usability-standards
autonomy_level: L1-L4
version: 1.0.0
tags: [usability, ux, loading-states, empty-states, error-boundaries, feedback]
summary: The mandatory 4-State UI rule (Empty, Loading, Error, Data) and micro-interaction standards for all generated views.
---

# The 4-State UI & Usability Heuristics `[🤖 AGENT]`

> **Audience:** `🤖 Agent / Autonomous` &nbsp;|&nbsp; **Classification:** Usability Rules

---

## 1. The Mandatory 4-State Rule `[🤖 Agent]`
Every frontend view, table, dashboard card, or Forged App produced by an agent **MUST** implement all four states:

1. **Zero / Empty State:** Never render blank white screens or empty tables without context. Show an illustrative icon, explanation, and a clear call-to-action (CTA) button (e.g. *"Create First Mission"*).
2. **Pending / Loading State:** Skeleton cards matching the final layout shape (`<Skeleton className="h-24 w-full" />`) or spinner with progress text. Submit buttons must disable during mutation (`disabled={isPending}`).
3. **Error Boundary State:** Display human-actionable error messages with a retry trigger (`<Button onClick={() => refetch()}>Try Again</Button>`) rather than raw stack traces.
4. **Active Data State:** Well-formatted, sortable, paginated data with sticky headers.

---

## 2. Agent Self-Verification Checklist `[🤖 Agent]`
Before completing any UI creation or modification task, the agent must check:
- [ ] Are buttons disabled when `isPending: true`?
- [ ] Is there an empty state if data array is length `0`?
- [ ] Is there an error alert if query fails?
- [ ] Are numerical metrics formatted with `tabular-nums`?
