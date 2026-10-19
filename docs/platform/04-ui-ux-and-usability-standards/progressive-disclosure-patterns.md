---
id: progressive-disclosure-patterns
title: Progressive Disclosure & High-Density UI Architecture
audience: [AGENT_PRIMARY, HUMAN_PRIMARY]
badge: HYBRID
category: 04-ui-ux-and-usability-standards
autonomy_level: L0-L4
version: 1.0.0
tags: [ux, progressive-disclosure, drawers, tabs, accordions, density, ui-design]
summary: Standards for structuring complex multi-attribute data into tiered views (KPI Summary -> Filtered Table -> Detail Drawer).
---

# Progressive Disclosure & Information Density `[🤝 HYBRID]`

> **Audience:** `🤝 Hybrid: Builder + Agent` &nbsp;|&nbsp; **Classification:** UI Design Principles

---

## 1. The 3-Tier Progressive Disclosure Rule `[🤖 Agent]`
When building user interfaces for large enterprise datasets, agents **MUST NOT** dump all fields onto a single flat table. Instead, structure the screen across three progressive discovery tiers:

```mermaid
graph TD
    Tier1["Tier 1: High-Level KPI Summary Cards<br/>(Total Count, Anomaly Count, Success Rate, Trends)"]
    Tier1 --> Tier2["Tier 2: Paginated Scannable Table / Canvas<br/>(Key Identifier, Status Badge, Primary Timestamp, Quick Action)"]
    Tier2 --> Tier3["Tier 3: Slide-Over Inspection Drawer / Modal<br/>(Full JSON Specs, W3C Traces, Audit History, Child Relations)"]
```

---

## 2. Component Guidelines `[🤖 Agent Implementation]`
* **Slide-over Drawer:** Use `<motion.div>` with a 360px–480px width, sticky header, multi-tab body (`Overview`, `Connections`, `Specs`, `Telemetry`), and escape key close handler.
* **Badges & Statuses:** Use semantic pill badges with light tinted backgrounds (`bg-emerald-500/10 text-emerald-400 border border-emerald-500/20`).
* **Table Scannability:** Keep primary table columns to a maximum of 5–6 essential columns with truncated overflow and tooltips on hover.
