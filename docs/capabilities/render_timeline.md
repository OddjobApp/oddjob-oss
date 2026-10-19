# 📈 Render Timeline
> **ID:** `render_timeline`
> **Version:** `1.0.0`
> **Schema Version:** `1`
> **Category:** Rich UI
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

## Description
Render a timeline in the assistant chat to display sequences of events, milestones, or processes. Use this whenever you need to show chronological data (e.g. project milestones, release schedules, process flows, history). Supports horizontal and vertical layouts with dates and status indicators. Always use this instead of describing timelines in prose for better visual clarity.

---

## Inputs

| Name        | Type   |
|-------------|--------|
| `title`     | string |
| `description` | string |
| `layout`    | enum   |
| `events`    | array  |

---

## Outputs

| Name     | Type   |
|----------|--------|
| `result` | string |

---

## Business Use Cases
> [!NOTE] No explicit business use cases declared.

---

## Guardrails
> [!NOTE] No explicit guardrails declared.
