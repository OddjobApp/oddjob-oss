# Signal Studio Feature Documentation

> **Spec References:**
> - [Signal Studio Proposal](../proposals/SIGNAL_STUDIO_GENERAL_PURPOSE_HARVESTING_PROPOSAL.md)
> - [Industry Packs Best Practices](../guidelines/signal-studio-industry-packs-best-practices.md)
> - [Signal Studio Best Practices Guide](../guidelines/signal-studio-best-practices.md)
> - [Universal Event Envelope Specification](../UNIVERSAL_EVENT_ENVELOPE.md)
> - [Signal Intelligence Spatial Rules](../SIGNAL_INTELLIGENCE_SPATIAL_RULES.md)
> - [Mount Signal Studio Capability](../capabilities/mount_signal_studio.md)

---

## **Feature Overview**

### **Purpose & Business Value**
Signal Studio is Oddjob's **Layer 0 Event Harvesting and Spatial Intelligence Engine**. It serves as the single source of truth for capturing raw external signals—originating from REST polling schedules, push webhooks, RSS/Atom feeds, headless browser scrapers, or real-time Kafka streams—normalizing them into universal event envelopes, computing spatial Uber H3 hexagonal coordinates, and routing operational anomalies into CREW deliberation rooms and Flow Studio automated execution DAGs.

By maintaining strict domain-agnostic separation at the platform layer and offering modular **Industry Solution Packs**, Signal Studio enables organizations across real estate, global logistics, compliance, treasury, cybersecurity, and facilities management to monitor mission-critical indicators without writing custom ingestion microservices.

### **User Personas & Use Cases**
- **Operations & Acquisition Leads:** Inspecting real-time distress signals (e.g. Notice of Default, municipal tax liens, port congestion advisories) on the interactive spatial radar and launching automated acquisition/mitigation workflows.
- **Data & Integration Engineers:** Configuring universal webhook endpoints, mapping incoming arbitrary JSON payloads to canonical dimensions using the visual JSONPath Schema Mapper, and validating coordinate extraction.
- **Risk & Compliance Officers:** Establishing CEL (Common Expression Language) predicate rules to catch regulatory changes, sanctions list modifications (OFAC), or critical zero-day CVE advisories and routing them to human approval gates.
- **Autonomous CREW Agent Panels:** Subscribing to high-confidence signals to initiate multi-agent war rooms with pre-populated contextual briefs.

### **Key Requirements & Constraints**
- **Strict Multi-Tenant Scoping:** Every harvested signal, feed configuration, and filter predicate must be partitioned by `organizationId`. Cross-tenant queries are blocked using `getOrgConditions`.
- **Domain-Agnostic Core:** Core UI components must never assume specific vertical fields (e.g. loan interest rates or parcel numbers). Vertical intelligence is encapsulated in Industry Packs.
- **Zero Loss Raw Payload Storage:** Incoming JSON payloads must be preserved in `event_primitives.rawPayload` for auditing and historical schema remapping.
- **Deterministic H3 Spatial Indexing:** Latitude and longitude must be parsed to valid WGS-84 ranges, and spatial indexes calculated at Uber H3 Resolution 7 (~1.2 km precision) by default.
- **Cryptographic Deduplication:** Inbound payloads must be fingerprint-hashed (SHA-256) across feed identifier and content body to prevent duplicate alerts.

### **Success Metrics**
- **Ingestion Latency:** < 50ms from HTTP webhook receipt to database persistence and spatial indexing.
- **Mapping Accuracy:** 100% extraction match across configured JSONPath and dot-notation paths.
- **Deduplication Rate:** Zero duplicate events processed within the active cooldown window (300 seconds).
- **Zero UI Freezes:** Mapbox vector rendering and H3 hexagonal clustering must maintain 60 FPS across 5,000+ active spatial markers.

---

## **User Interface Documentation**

### **Screens & Navigation**

Signal Studio is accessible as a full-page operational workspace at `/signals` or `/workspace/signals`, and as an inline side-rail Studio Pod (`mount_signal_studio`) within CREW Chat rooms.

The Studio features a clean, tabbed header with 5 primary modes:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 📡 SIGNAL STUDIO — Real-Time Event Harvesting & Spatial Intelligence                                   │
├───────────────────┬───────────────────┬───────────────────┬───────────────────┬────────────────────────┤
│  1. Live Stream   │  2. Filter Rules  │  3. Ingress Mapper│  4. Industry Packs│  5. Sources / Feeds    │
│  (Workbench)      │  (CEL Builder)    │  (JSONPath Studio)│  (Modular Schemas)│  (Harvester Health)    │
└───────────────────┴───────────────────┴───────────────────┴───────────────────┴────────────────────────┘
```

#### **1. Live Stream & Triage (`SignalsDecisionsWorkbench`)**
- **Purpose:** Real-time chronological timeline and operational triage workbench for incoming event primitives.
- **Visuals:** Metric cards for Total Harvested, Active Signals, Escalated Items, and Low-Confidence Noise.
- **Controls:** Multi-attribute filtering (Source Feed, Category, Severity, Status, Confidence Threshold slider).
- **Inspection Drawer:** Clicking any signal row opens a slide-over drawer showing mapped dimensions, geocoded coordinates, H3 index badge, causal links, and formatted, syntax-highlighted raw JSON payload.

#### **2. Filter Rules (`SignalFilterBuilder`)**
- **Purpose:** Rule and predicate editor where operators define trigger criteria and downstream actions.
- **Controls:** Add/Edit filter rules, toggle active status, specify CEL expression strings, set trigger actions (Notify CREW, Trigger Flow, Post Webhook, Mount HIL Gate).
- **Simulation:** Real-time test button evaluating the rule against the last 50 harvested signals.

#### **3. Ingress Mapper (`JsonPathSchemaMapper`)**
- **Purpose:** Interactive schema mapping studio for universal webhook feeds.
- **Left Panel (JSON Payload Editor):** Raw JSON payload editor with syntax highlighting, sample payload loaders, and format validation.
- **Right Panel (Mapping Form):** Interactive input fields for canonical target dimensions (`title`, `summary`, `category`, `severity`, `latitude`, `longitude`, `timestamp`, `metadata`). Supports both dot-notation (`data.lat`) and JSONPath (`$.coordinates.latitude`) with fallback literals (`||`).
- **Preview & Test:** Live "Test Extraction" button calling `POST /api/signals/ingress/test-mapping` to render a prospective normalized event card with computed H3 index.

#### **4. Industry Packs (`IndustryPacksView`)**
- **Purpose:** 1-click catalog of modular solution packs.
- **Packs Available:**
  1. *Residential Real Estate Distress & Acquisition Pack*
  2. *Global Supply Chain & Logistics Pack*
  3. *Regulatory, Sanctions & Trade Policy Pack*
  4. *Macroeconomic & Central Banking Pack*
  5. *Critical Cloud & Cybersecurity Resilience Pack*
  6. *Severe Weather & Energy Grid Resilience Pack*
  7. *Corporate Filings & Competitor Watchlist*
- **Action:** Clicking "Activate Pack" instantiates default feed presets, registers schema extraction rules, and populates recommended CREW deliberation playbooks.

#### **5. Sources & Harvester Feeds (`SourcesView`)**
- **Purpose:** Connectivity and health monitoring for all external collectors.
- **Metrics:** Last sync time, ingestion throughput (events/min), failure counts, and endpoint status.
- **Management:** Add new REST poller, configure polling intervals (300s to 3600s), set Bearer/Basic credentials, and view generated webhook URLs (`/api/signals/ingress/events/:feedId`).

---

### **Component Hierarchy**

```
client/src/modules/signal-studio/
├── SignalStudioPod.tsx                      # Root Studio container & tab routing
├── SignalsDecisionsWorkbench.tsx           # Triage timeline, metrics, inspection drawer
├── SignalFilterBuilder.tsx                  # Predicate rule editor & CEL evaluation
├── JsonPathSchemaMapper.tsx                 # Visual JSONPath & dot-notation schema mapper
├── industry-packs.ts                        # Pre-configured Industry Solution Pack definitions
├── signal-filters-store.ts                  # Zustand state management for filter rules
└── types.ts                                # Core TypeScript interfaces & contracts
```

---

## **API Documentation**

### **Endpoint Specifications**

#### **1. Ingest Webhook Event**
- **Path:** `POST /api/signals/ingress/events/:feedId?` (also aliased at `/api/oddjob/signal/ingress/events/:feedId?`)
- **Headers:** `Content-Type: application/json`, `x-organization-id: <number>` (or authenticated session)
- **Request Body:** Arbitrary valid JSON payload.
- **Query Params:** Optional query string containing inline schema mappings (e.g. `?pathTitle=$.name&pathLat=$.lat&pathLng=$.lng`).
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "event": {
      "id": 1849,
      "organizationId": 342,
      "title": "Notice of Default - 14282 Newport Ave",
      "summary": "Recorded default arrears of $42,850.00",
      "category": "Notice of Default",
      "severity": "high",
      "latitude": 33.7456,
      "longitude": -117.8262,
      "h3Index": "872834714ffffff",
      "contentHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "createdAt": "2026-09-28T19:40:00Z"
    }
  }
  ```
- **Duplicate Response (200 OK):**
  ```json
  {
    "success": true,
    "duplicate": true,
    "message": "Duplicate event ignored within cooldown window"
  }
  ```

#### **2. Test Ingress Schema Mapping (Dry Run)**
- **Path:** `POST /api/signals/ingress/test-mapping`
- **Request Body:**
  ```json
  {
    "payload": { "address": "100 Main St", "pos": { "lat": 34.05, "lng": -118.25 } },
    "rules": {
      "pathTitle": "address",
      "pathLat": "pos.lat",
      "pathLng": "pos.lng",
      "pathCategory": "Property"
    }
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "extracted": {
      "title": "100 Main St",
      "category": "Property",
      "severity": "medium",
      "latitude": 34.05,
      "longitude": -118.25,
      "h3Index": "8729a1b24ffffff",
      "contentHash": "a1b2c3d4e5f6..."
    }
  }
  ```

---

## **Component Architecture**

### **State Management (`signal-filters-store.ts`)**
Signal Studio uses a lightweight Zustand store for reactive rule state with localStorage persistence:
```typescript
interface SignalFiltersState {
  filters: SignalFilter[];
  activeFilterId: string | null;
  addFilter: (filter: Omit<SignalFilter, 'id' | 'createdAt' | 'updatedAt'>) => SignalFilter;
  updateFilter: (id: string, updates: Partial<SignalFilter>) => void;
  deleteFilter: (id: string) => void;
  setActiveFilter: (id: string | null) => void;
}
```

### **Backend Mapper Service (`EventJsonPathMapperService`)**
Located at [`server/domain/signal-intelligence/core/event-jsonpath-mapper.service.ts`](../../server/domain/signal-intelligence/core/event-jsonpath-mapper.service.ts):
- Extracts values using dot-notation splitting and recursive JSON path traversal.
- Evaluates `||` fallback expressions.
- Normalizes coordinates and invokes `h3-js` to compute `latLngToCell(lat, lng, 7)`.
- Generates SHA-256 payload fingerprints.

---

## **Integration Points**

### **1. CREW Chat Integration**
- **Action:** Predicate triggers dispatch alerts to active CREW rooms via `POST /api/crew/message` or SSE stream events.
- **Context:** The alert payload includes structured dimensions (`title`, `severity`, `h3Index`, `summary`) and links to the full inspection drawer in Signal Studio.
- **Agent Seating:** Industry packs specify required agent personas (e.g. *Acquisitions Copilot*, *Quartermaster*, *CISO Sentinel*).

### **2. Flow Studio & Autonomous DAGs**
- **Action:** Signals matching criteria (e.g. `severity == 'critical'`) trigger background pipelines via `workflow-signal-subscription.service.ts`.
- **Deduplication:** Ensured at the database constraint level (`unique(subscription_id, event_id)`).

### **3. Human-In-The-Loop (HIL) Governance**
- High-stakes signals (e.g. real estate purchase offer generation, emergency network rerouting) require human sign-off via HIL approval dialogs before execution proceeds.

---

## **Security & Multi-Tenant Boundaries**

1. **Mandatory Organization Scoping:**
   - Universal Webhook Ingress verifies that the calling route or API key resolves to an authorized `organizationId`.
   - All database reads and writes to `event_primitives` must use `getOrgConditions(authContext, eventPrimitives)`. Never write raw un-scoped queries.
2. **Cryptographic Deduplication:**
   - Ingress computes `sha256(feedId + ":" + rawBodyString)`. If a duplicate is received within the ingestion cooldown window (default: 300 seconds), it is acknowledged with HTTP 200 `{ "duplicate": true }` but discarded to prevent duplicate rounds in CREW chat.
3. **No Secret Leakage:**
   - External feed API credentials (Basic Auth passwords, Bearer tokens, private endpoints) must be encrypted using `encrypt()` and stored in `encrypted_credentials`, never committed to source files or included in client-visible JSON responses.

---

## **Testing & Verification**

The Signal Studio test suite covers units, components, and integration endpoints:
```bash
# 1. Backend Unit Tests
npx vitest run server/domain/signal-intelligence/tests/event-jsonpath-mapper.test.ts
npx vitest run server/domain/signal-intelligence/tests/event-ingress-routes.test.ts

# 2. Frontend Component Tests
npx vitest run client/src/modules/signal-studio/JsonPathSchemaMapper.test.tsx
npx vitest run client/src/modules/signal-studio/SignalStudioPod.test.tsx
npx vitest run client/src/modules/signal-studio/SignalsDecisionsWorkbench.test.tsx

# 3. Global Type-Check & Verification
npm run check
npm run lint:theme
```
