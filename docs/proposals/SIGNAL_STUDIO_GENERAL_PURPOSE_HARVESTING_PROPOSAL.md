# Proposal: Restoring Signal Studio as a General-Purpose Customizable Event Harvesting Engine

> **Status:** Proposed  
> **Author:** Antigravity Engineering  
> **Target Date:** 2026-Q4  
> **Scope:** `client/src/modules/signal-studio/`, `server/domain/signal-intelligence/`, `shared/schema/`  
> **Architectural Tier:** Layer 0 (Signal & Telemetry) in Oddjob's 5-Layer AI Control Plane

---

## 1. Executive Summary & Problem Statement

### 1.1 The Architectural Drift
Signal Studio was originally conceived as the foundational **Layer 0 Event Harvesting and Ingestion Engine** of the Oddjob 5-Layer AI Control Plane—responsible for harvesting raw signals from arbitrary external sources (REST APIs, webhooks, RSS/Atom feeds, Kafka streams, headless browser scrapers), normalizing them into universal event envelopes, computing spatial H3 coordinates, and routing anomalies into CREW deliberation rooms and Flow Studio pipelines.

Over recent iterations, Signal Studio has experienced **vertical domain coupling**:
1. Specific residential real estate distress criteria (Notice of Default, Scheduled Trustee Auctions, County Tax Liens, Substandard housing, Probate filings) were hardcoded directly into the core spatial map component (`SpatialH3MapPanel`).
2. Real-estate underwriting tape analytics (note interest rates, remaining principal, loan vintages, Subject-To arbitrage logic, Zillow listing photo lookups) were integrated directly into the general-purpose spatial panel.
3. Centroid location jumps were coupled to a fixed California/Orange County ZIP code directory.

### 1.2 The Goal
Restore Signal Studio to a **pure, domain-agnostic, customizable event harvesting and signal intelligence tool** while migrating domain-specific applications (such as the Residential Real Estate Distress pipeline) into **Modular Industry Solution Packs** and **CREW Chat Assemblies**.

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              RESTRUCTURED SIGNAL STUDIO TOPOLOGY                                       │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Layer 0: Pluggable Signal Harvesting Engine (Signal Studio Platform)                                   │
│   • Universal Ingress: Webhooks, REST Polling, RSS/Atom, Headless Scrapers, Kafka, SSE, File Drop       │
│   • Schema Inferencer & Visual Field Mapper: JSONPath, CEL, & LLM extraction into Universal Envelopes │
│   • Spatial Telemetry & H3 Encoder: Lat/Lng, Geocoding, & Uber H3 Hexagonal Cell Indexing (Res 0-15)  │
│   • Rule & Predicate Engine: CEL filtering, temporal velocity, geofence breaches, threshold alerts   │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Layer 1: Modular Industry Solution Packs (Domain Configuration Layer)                                  │
│   • Real Estate Distress Pack (NOD, Auctions, Tax Liens, Loan Tape, Zillow Comps)                     │
│   • Maritime & Supply Chain Pack (AIS vessel telemetry, port dwell, dark vessel anomalies)             │
│   • Infrastructure & IoT Pack (Vibration telemetry, heat signatures, predictive maintenance)          │
│   • Cyber & SecOps Pack (CVE feeds, SIEM logs, dark web breach monitors)                              │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Layer 2: CREW Chat Assemblies & Flow Studio Dispatches (Operational Execution)                         │
│   • Residential Real Estate Distress Assembly (4-stage acquisition wizard in CREW)                     │
│   • Autonomous Dispatch to Flow Studio Pipelines & HIL Governance Gates                               │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Architectural Pillars of the General-Purpose Harvesting Tool

### Pillar 1: Pluggable Source Harvesters (Fetchers)
Signal Studio must allow operators to register, configure, and monitor any external datasource without writing backend code:

| Ingestion Connector | Ingress Model | Supported Features |
| :--- | :--- | :--- |
| **REST API Poller** | Scheduled Pull (cron) | Configurable polling interval, header authentication (Bearer/Basic/API Key), pagination schemas (cursor, offset), delta-state tracking. |
| **Universal Webhook Ingress** | Push (HTTP POST) | Dedicated endpoint minting (`/api/signal-ingress/:channelId`), HMAC SHA-256 signature verification, replay protection. |
| **RSS / Atom Feed Harvester** | Scheduled Pull | Feed parsing, deduplication by GUID/link, auto-discovery of full-text article links. |
| **Headless Browser Scraper** | Scripted Autonomous Pull | Integration with Computer Use / Selenium runners for harvesting sites lacking public APIs (e.g. county recorder portals, auction lists). |
| **Kafka / Message Bus Stream** | Real-Time Push | Partitioned topic consumption, avro/protobuf/json deserialization, consumer lag monitoring. |
| **Manual / File Batch Drops** | Ad-Hoc Upload | CSV, GeoJSON, and JSON Lines import with interactive column mapping. |

### Pillar 2: Dynamic Schema Inference & Visual Field Mapper
Currently, `event_primitives` enforces closed TypeScript unions (`targetSector`, `severity`, `jurisdiction`). A general-purpose harvesting tool must handle arbitrary payloads:
1. **Raw Payload Ingestion**: Store the unmutated raw payload in a `rawPayload: jsonb` column.
2. **Interactive Schema Mapper**:
   - A visual UI where users paste or inspect a sample JSON payload.
   - Operators map incoming JSON paths to canonical dimensions:
     - `title`: `$.property.address` or `$.vessel.name`
     - `timestamp`: `$.filingDate` or `$.telemetry.epoch`
     - `latitude` & `longitude`: `$.coordinates.lat`, `$.coordinates.lng`
     - `category` / `eventType`: User-defined string or enum
     - `severity`: Custom scoring rule or direct field mapping
     - `metadata`: Arbitrary key-value bag
3. **LLM Structured Extraction Fallback**:
   - For unstructured text feeds (e.g. press releases, legal notices, inspection reports), provide an optional extraction schema executed by Gemini/LLM to extract structured entities into the universal envelope.

### Pillar 3: Domain-Agnostic Spatial H3 Canvas (`SpatialCanvasBlock`)
The interactive map canvas must not assume parcels or mortgages:
1. **Universal Geospatial Rendering**:
   - Render any event carrying coordinates (`latitude`, `longitude`) or an `h3Index`.
   - Cluster markers dynamically with configurable icon sets based on event category (not just real estate default icons).
2. **Configurable Property Inspector**:
   - Clicking any marker opens a generic **Signal Inspection Drawer** rendering the mapped attributes and raw JSON payload in a syntax-highlighted inspector, rather than a fixed residential dossier.
3. **Pluggable Preset Locations**:
   - Replace the hardcoded Orange County ZIP list with dynamic viewport jumps based on detected event clusters or user-configured regional presets.

### Pillar 4: Rule-Based Predicate Engine & Action Dispatchers
Allow operators to define trigger conditions that elevate harvested events into actionable items:
1. **Filter Expressions**: CEL (Common Expression Language) or visual condition builders:
   - `event.severity == 'critical' && event.attributes.amount > 50000`
   - `spatial.within_geofence('port_of_long_beach') && event.dwell_minutes > 120`
2. **Action Dispatch Channels**:
   - **Send to CREW Room**: Post a structured alert into an active multi-agent topic room.
   - **Trigger Flow Studio Pipeline**: Trigger an automated background job or DAG.
   - **Webhook Out / Slack / Email**: Notify external operational endpoints.
   - **Mount HIL Approval Form**: Elevate high-risk detections to a human approval gate.

---

## 3. Decoupling the Residential Distress Assembly

The residential distressed real estate solution is a high-value vertical capability, but it should live cleanly as a **consumer** of Signal Studio rather than being embedded inside it.

### Step 1: Package the Real Estate Distress Industry Pack
Create `shared/industry-packs/residential-distress-pack.ts`:
- **Pre-configured Feed Presets**: County recorder RSS, tax delinquent portals, auction calendars.
- **Custom Schema Attributes**: `apn`, `noticeDate`, `defaultAmount`, `loanType`, `interestRate`, `remainingPrincipal`, `estimatedValue`, `ltv`.
- **Pre-defined Rules**: High delinquency debt spike, Sub-3.5% loan rate lock detection, upcoming auction within 14 days.

### Step 2: Formalize the CREW Assembly Blueprint
Move the multi-step real estate acquisition workflow into the CREW Composable Creation Studio via [`shared/residential-distress-assembly.ts`](../../shared/residential-distress-assembly.ts):
- **Stage 1**: Spatial Signal Discovery (reads general-purpose spatial events filtered by the pack).
- **Stage 2**: Mortgage Underwriting & Loan Tape (the dedicated `MortgageTrendsDialog` and CSV exporter).
- **Stage 3**: Property Dossier & Zillow Photo Comps (the `PropertyDossierDialog` and Scribe Studio exporter).
- **Stage 4**: HIL Acquisition Offer Gate (the governance signoff).

---

## 4. UI/UX Specification for the Restored Signal Studio

Signal Studio ([`client/src/modules/signal-studio/SignalStudioPod.tsx`](../../client/src/modules/signal-studio/SignalStudioPod.tsx)) will feature 5 clean, general-purpose tabs:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 📡 SIGNAL STUDIO — Real-Time Event Harvesting & Spatial Intelligence                                   │
├───────────────────┬───────────────────┬───────────────────┬───────────────────┬────────────────────────┤
│  1. Sources       │  2. Live Stream   │  3. Spatial Radar │  4. Rules & CEL   │  5. Industry Packs     │
│  (Harvest Feeds)  │  (Triage & Ingest)│  (Uber H3 Engine) │  (Triggers/Alerts)│  (Modular Schemas)     │
└───────────────────┴───────────────────┴───────────────────┴───────────────────┴────────────────────────┘
```

### Tab 1: Sources & Harvesters (`SourcesView`)
- Manage active feeds: HTTP Poller, Webhook Ingress, RSS, Selenium Scraper.
- Status cards displaying: last sync timestamp, event ingestion rate (events/min), failure counts, and health indicators.
- "Add New Harvester" modal with interactive auth credential assignment and connection testing.

### Tab 2: Live Stream & Triage (`SignalsDecisionsWorkbench`)
- Unified timeline stream of all incoming normalized event primitives.
- Quick filters: Source channel, status, confidence score threshold, severity level.
- Detail drawer: JSON schema inspector, raw payload, event provenance, and causal links.

### Tab 3: Spatial Radar (`SpatialCanvasBlock`)
- Mapbox vector tiles with Uber H3 hexagonal aggregation overlay.
- Dynamic clustering based on viewport bounds.
- Metric heatmap selector (Event count, average severity, temporal velocity).
- Spatial boundary tools: polygon geofencing and radius centroids.

### Tab 4: Rules & Dispatches (`RuleBuilder`)
- Visual condition builder: `IF [field] [operator] [value] THEN [action]`.
- Actions: Post to CREW room, trigger flow pipeline, notify webhook, create draft mission.
- Real-time simulation: test rules against the last 100 harvested events.

### Tab 5: Industry Packs (`IndustryPacksView`)
- 1-click installation of specialized schemas, scrapers, and rules:
  - 🏡 **Residential Real Estate Distress Pack** (NOD, trustee auctions, mortgage underwriting tape)
  - 🚢 **Maritime & Harbor Logistics Pack** (AIS tracking, berth dwell times, anchorage congestion)
  - 🏭 **Industrial IoT & Predictive Maintenance Pack** (Sensor vibration, temperature spikes)
  - 🛡️ **Cyber Incident & Threat Intelligence Pack** (CVE vulnerability streams, SIEM ingest)

---

## 5. Technical Implementation Plan & Milestones

| Phase | Tasks & Deliverables | Quality Gates |
| :--- | :--- | :--- |
| **Phase 1: Decoupling & Pack Isolation** | 1. Move `DISTRESS_SIGNAL_CRITERIA`, mortgage tape calculations, and Zillow dossier helpers out of `PredictionIntelligenceDashboard.tsx` into a dedicated pack module.<br>2. Wire the Residential Real Estate Distress Assembly in CREW chat ([`residential-distress-assembly.ts`](../../shared/residential-distress-assembly.ts)). | `npm run test`<br>`npm run lint:theme`<br>`npm run lint:dialogs` |
| **Phase 2: Generic Spatial Canvas** | 1. Generalize `SpatialH3MapPanel` into `SpatialCanvasBlock` accepting generic `SpatialMarker<T>` props.<br>2. Replace hardcoded Orange County presets with dynamic centroid calculation based on markers.<br>3. Provide generic property drawer with syntax-highlighted JSON viewer. | `npm run check`<br>Vitest spatial regression suite |
| **Phase 3: Universal Ingestion Workbench** | 1. Upgrade `SourcesView` to support generic Webhook creation and polling schedule editor.<br>2. Build the visual JSONPath Field Mapper component.<br>3. Connect universal event envelope ingress endpoint (`/api/signal-ingress/:channelId`). | API integration tests<br>End-to-end webhook ingest test |
| **Phase 4: Rule Engine & CREW Bridge** | 1. Connect the CEL filter evaluator in `RuleBuilder`.<br>2. Support dynamic "Send to CREW" payloads based on user-selected fields rather than hardcoded distress parcels. | Tool idempotency check<br>Playwright CREW chat verification |

---

## 6. Backward Compatibility & Non-Breaking Migration

1. **Zero Database Table Drops**: Existing `event_primitives` rows remain fully intact. The spatial columns (`latitude`, `longitude`, `h3_index`) added in migrations `0041-0042` serve as the universal spatial substrate.
2. **Preserving Existing Routes**: The `/spatial` route continues to work; if the organization has the `residential_real_estate` pack enabled, it defaults to the real estate distress layout. Otherwise, it presents the generic spatial radar.
3. **Seamless CREW Experience**: The `Residential Real Estate Distress Assembly` in CREW chat operates without disruption, using the modularized pack while leaving the base platform clean.
