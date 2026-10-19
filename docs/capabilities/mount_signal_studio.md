# 🛠️ Mount Signal Studio

> **Capability ID:** `mount_signal_studio`  
> **Capability Version:** `1.1.0`  
> **Manifest Schema:** `v1`  
> **Category:** Spatial & Signal Intelligence  
> **Owner:** platform  
> **Risk Profile:** Low (Read-Safe Artifact Presentation)  
> **Execution Environment:** Host / Browser Side-Rail Studio Pod  

---

## Overview

Mounts **Signal Studio** in the interactive side-rail beside the CREW conversation, allowing visual inspection of spatial H3 telemetry, market signals, ingestion feeds, visual JSONPath mapping schemas, and pre-engineered **Industry Starter Packs**.

Signal Studio is accessible as a full-page operational workspace at `/signals` or `/workspace/signals`, and as an inline side-rail Studio Pod (`mount_signal_studio`) within CREW Chat rooms.

---

## Inputs

| Name | Type | Description |
| :--- | :--- | :--- |
| `view` | `enum` | View tab to open: `"overview"`, `"dashboard"`, `"spatial"`, `"signals"`, `"sources"`, `"rules"`, `"filters"`, `"packs"`, `"mapper"`. Defaults to `"overview"`. |
| `signalId` | `string` | *(Optional)* ID of the active signal or event primitive to inspect. |
| `title` | `string` | *(Optional)* Title or header for the studio pod (e.g., `"Signal Studio Industry Starter Packs"`). |

## Outputs

| Name | Type | Description |
| :--- | :--- | :--- |
| `result` | `string` | JSON artifact descriptor containing `type: "signal_studio_pod"`, `component: "SignalStudioPod"`, and mount properties. |

---

## Supported Studio Views

1. **`overview` / `dashboard`**: High-level real-time KPI overview, active signals list, and watchlist channel health.
2. **`spatial`**: Interactive 3D/2D Uber H3 hexagonal spatial radar and geofence anomaly inspector with bi-directional dispatch to CREW.
3. **`signals`**: Native Signals & Decisions Workbench with tabular filtering, triage status, and 1-click initiative launching.
4. **`sources`**: Ingestion connector manager (RSS, SEC EDGAR, REST APIs, GeoJSON, Webhooks).
5. **`rules`**: CEL (Common Expression Language) evaluation rule builder and subscription dispatch.
6. **`packs`**: **Curated Industry Intelligence Starter Packs** with 1-click feed provisioning and CREW deliberation playbooks.
7. **`mapper`**: Visual drag-and-drop JSONPath schema mapper for universal webhook payload transformation.

---

## Industry Starter Packs (`view: "packs"`)

When Copilot or a user requests pre-configured signals or industry templates, calling `mount_signal_studio({ view: "packs", title: "Signal Studio Industry Starter Packs" })` presents the 7 pre-engineered starter packs:

| Pack ID | Pack Name | Target Role | Channels & Ingress Feeds | Default CREW Playbook |
| :--- | :--- | :--- | :--- | :--- |
| `residential_distress` | **Residential Real Estate Distress & Acquisition** | Acquisitions Lead | Notice of Default (NOD), Trustee Auctions, Tax Liens, Substandard Red-Tags | Launch Residential Distress Assembly in CREW with HIL offer sign-off |
| `supply_chain` | **Global Supply Chain & Logistics** | VP Supply Chain / COO | Maritime AIS Corridors, Port Congestion, FreightWaves carrier advisories | Recalculate delivery milestones and initiate supplier rerouting RFP |
| `regulatory` | **Regulatory, Sanctions & Trade Policy** | General Counsel / CCO | SEC EDGAR 8-K/10-K, USTR Section 301 Tariffs, EU Directives (AI Act/CSRD) | Screen master vendor list against new OFAC entries and file RFC |
| `macroeconomic` | **Macroeconomic & Central Banking** | CFO / Treasury | Federal Reserve FOMC Bulletins, Discount Window, Dow Jones / MarketWatch Pulse | Update cost-of-capital forecast and trigger FX exposure assessment |
| `cyber_cloud` | **Critical Cloud & Cybersecurity Resilience** | CISO / VP Engineering | CISA Known Exploited Vulnerabilities (KEV), Multi-Cloud API Health Streams | Trigger automated multi-region failover and notify customer success |
| `weather_grid` | **Severe Weather & Energy Grid Resilience** | VP Operations / Facilities | National Weather Service (NWS) CAP Alerts, Hurricane Cones, Regional Power Grids | Trigger facility contingency checklist and shift critical workloads |
| `competitor_corp` | **Corporate Filings & Competitor Watchlist** | Head of Corporate Strategy | TechCrunch Venture Shifts, Competitor M&A, Reddit Community Operational Intel | Draft competitive counter-brief in Scribe Studio and alert sales |

---

## Copilot Behavioral Contract

When a user in CREW asks about starter packs, industry signals, or pre-configured telemetry:
1. **Always Mount the Surface**: Copilot calls `mount_signal_studio({ view: "packs", title: "Signal Studio Industry Starter Packs" })` immediately.
2. **Never Hallucinate Raw Records**: Copilot states what connected feeds provide and explains that activating a pack auto-provisions ingest feeds, JSONPath mappings, and CEL triage rules.
3. **Offer Next-Step Actions**: Guide the user on activating the pack directly in the side-rail or launching the associated CREW autonomous cycle or HIL approval workflow.
