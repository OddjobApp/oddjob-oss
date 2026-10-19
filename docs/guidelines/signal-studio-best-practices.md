# Signal Studio Best Practices Guide

> **Status:** Active  
> **Audience:** Core Engineers, Solution Developers, AI Control Plane Architects  
> **Architectural Tier:** Layer 0 (Telemetry, Harvesting & Spatial Intelligence)  
> **Related Documents:**
> - [Industry Packs Best Practices](./signal-studio-industry-packs-best-practices.md)
> - [Signal Studio Feature Documentation](../feature-documentation/signal-studio.md)
> - [Signal Studio General Purpose Harvesting Proposal](../proposals/SIGNAL_STUDIO_GENERAL_PURPOSE_HARVESTING_PROPOSAL.md)
> - [Distributed Tracing Implementation Plan](../../.agent/workflows/distributed-tracing-implementation.md)

---

## 1. Architectural Principles

Signal Studio is Oddjob's general-purpose, domain-agnostic event harvesting and spatial intelligence engine. To avoid architectural drift and tight coupling, engineers and operators must adhere to these foundational principles:

### 1.1 Decouple Platform from Vertical Domains
- **Domain-Agnostic Core:** The core Signal Studio components ([`SignalStudioPod.tsx`](../../client/src/modules/signal-studio/SignalStudioPod.tsx), [`SignalsDecisionsWorkbench.tsx`](../../client/src/modules/signal-studio/SignalsDecisionsWorkbench.tsx), and [`JsonPathSchemaMapper.tsx`](../../client/src/modules/signal-studio/JsonPathSchemaMapper.tsx)) must never embed domain-specific attributes (such as residential mortgage interest rates, parcel loan tapes, or maritime AIS IMO numbers) into their core UI or database schemas.
- **Pack Isolation:** All domain-specific intelligence, specialized feed URLs, and default playbooks belong in **Modular Industry Solution Packs** ([`industry-packs.ts`](../../client/src/modules/signal-studio/industry-packs.ts)).
- **Consumer Pattern:** Specialized solutions (e.g., the Residential Distressed Real Estate acquisition pipeline) must act as **consumers** of harvested signals via CREW Chat Assemblies rather than modifying base platform code.

### 1.2 The Universal Ingress Contract
- Every incoming event—regardless of whether it originates from a webhook, REST poller, RSS feed, headless browser scraper, or Kafka topic—must be normalized into the canonical **Universal Event Envelope** ([`UniversalEventEnvelope`](../UNIVERSAL_EVENT_ENVELOPE.md)).
- Raw payloads must always be preserved unmutated in `event_primitives.rawPayload` for auditing, debugging, and future schema remaps.

---

## 2. Ingress & Harvester Engineering

### 2.1 Ingress Channels & Connectors

Signal Studio supports multiple ingestion mechanisms. Choose the appropriate pattern based on source constraints:

| Ingestion Mode | Appropriate For | Best Practice Configuration |
| :--- | :--- | :--- |
| **Universal Webhook (`POST /api/signals/ingress/events/:feedId?`)** | Systems with outbound webhook support (Stripe, GitHub, County Recorder Webhooks, Custom Microservices). | Verify incoming HMAC signatures; mandate payload timestamp verification within ±300s to prevent replay attacks. |
| **Scheduled REST Poller** | REST APIs lacking push webhooks (government portals, financial yield APIs). | Implement exponential backoff on 429/5xx; configure cursor or `since` query parameters to prevent full table scans. |
| **RSS / Atom Feed Puller** | Public regulatory bulletins, news feeds, court record publications. | Parse GUID/link for deduplication; maintain an in-memory or Redis LRU cache of recently processed GUIDs. |
| **Headless Browser Scraper (Computer Use / Selenium)** | Legacy portals lacking structured APIs (county tax rolls, auction calendars). | Run within isolated container sandboxes; capture HTML snapshots and store in artifact storage for verification. |
| **Spatial Kafka Consumer** | High-throughput sensor streams, IoT vibration, maritime AIS. | Consume partitioned topics; commit offsets only after database transaction persists or pipeline dispatches. |

### 2.2 Deduplication & Replay Protection
- Always compute a SHA-256 fingerprint across `feedId` + normalized payload body before persistence:
  ```typescript
  const contentHash = crypto.createHash("sha256")
    .update(`${feedId}:${JSON.stringify(rawPayload)}`)
    .digest("hex");
  ```
- If an event arrives with an identical hash within the deduplication window (default: 300 seconds), return HTTP 200 `{ "success": true, "duplicate": true }` and exit early to avoid triggering redundant CREW deliberation rounds or workflow executions.

---

## 3. Schema Mapping & JSONPath Best Practices

The visual JSONPath Schema Mapper ([`JsonPathSchemaMapper.tsx`](../../client/src/modules/signal-studio/JsonPathSchemaMapper.tsx)) allows operators to map arbitrary incoming payloads to canonical dimensions without writing code.

### 3.1 Mapping Rules & Syntax
- **Dot-Notation & Standard JSONPath:** Both simple dot-notation (`data.user.email`) and standard JSONPath expressions (`$.data.user.email` or `$.items[0].id`) are supported by [`EventJsonPathMapperService`](../../server/domain/signal-intelligence/core/event-jsonpath-mapper.service.ts).
- **Fallback Literals:** Use the `||` operator to specify alternate fields or default literals:
  ```
  title: "$.title || $.name || $.headline || Untitled Event"
  severity: "$.severity || $.priority || medium"
  ```
- **Type Coercion:** Coordinates (`latitude`, `longitude`) and timestamps must be strictly validated:
  - Latitude must parse to a finite float in `[-90, 90]`.
  - Longitude must parse to a finite float in `[-180, 180]`.
  - If coordinate fields evaluate to `0.0`, verify whether `0,0` (Null Island) is intentional; if not, suppress spatial indexing.

### 3.2 Live Preview & Interactive Testing
- Before saving a mapping schema to a feed, always verify extraction using `POST /api/signals/ingress/test-mapping`.
- The endpoint performs dry-run extraction, computes the prospective Uber H3 index, and returns formatted debug cards without writing to the database.

---

## 4. Geospatial Telemetry & Uber H3 Hexagonal Indexing

Spatial aggregation is a core differentiator of Oddjob's telemetry engine.

### 4.1 Resolution Guidelines
Oddjob standardizes on Uber H3 hexagonal spatial indexes:
- **Resolution 7 (Default):** ~1.2 km edge length / ~5.16 km² area. Ideal for regional real estate parcels, neighborhood clusters, harbor anchorages, and municipal distress grouping.
- **Resolution 9:** ~174 m edge length / ~0.1 km² area. Used for high-precision facility tracking, terminal berths, and campus-level building management.
- **Resolution 5:** ~8.5 km edge length / ~252 km² area. Used for metropolitan weather warnings, macro grid stress, and regional supply chain chokepoints.

### 4.2 Dynamic Centroid Jumps
- **Avoid Hardcoded Centroids:** Do not hardcode specific geographic coordinates (e.g. Orange County, CA `[33.7456, -117.8262]`) in production components.
- **Bounding Box Auto-Fitting:** Compute the dynamic centroid and bounding box from the active marker set:
  ```typescript
  const avgLat = markers.reduce((sum, m) => sum + m.lat, 0) / markers.length;
  const avgLng = markers.reduce((sum, m) => sum + m.lng, 0) / markers.length;
  ```

---

## 5. Predicate Rules & Downstream Dispatches

The Filter Builder ([`SignalFilterBuilder.tsx`](../../client/src/modules/signal-studio/SignalFilterBuilder.tsx)) evaluates incoming signals and executes downstream actions.

### 5.1 Common Expression Language (CEL) Guidelines
- Write deterministic, side-effect-free predicate expressions.
- **Example Rules:**
  - High Delinquency Real Estate: `event.category == 'Notice of Default' && event.attributes.defaultAmount >= 30000.0`
  - Port Congestion Alert: `event.category == 'Supply Chain Disruption' && event.attributes.dwellDays > 5.0`
  - Cybersecurity Zero-Day: `event.category == 'Security Incident' && event.severity == 'critical'`

### 5.2 Action Dispatch Hygiene
1. **CREW Deliberation Dispatch:**
   - When elevating an alert to a CREW chat room, pass a structured summary and relevant metadata attributes, not the entire unformatted raw JSON payload.
   - Attach the relevant Agent Card IDs (e.g., *Acquisitions Copilot*, *Quartermaster*, or *CISO Sentinel*) to ensure the correct specialists respond first.
2. **Flow Studio Pipeline Trigger:**
   - Ensure the target pipeline accepts `signalEventId` as a typed input parameter.
   - Maintain idempotency keys so that identical events do not re-run batch pipelines.
3. **Human-In-The-Loop (HIL) Gate:**
   - Any action involving capital allocation (e.g. issuing a real estate purchase offer) or system-destructive actions (e.g. DNS failover) **must** pause at an HIL form gate before execution.

---

## 6. Multi-Tenant Security & Tenant Isolation

Oddjob enforces strict tenant isolation boundaries across all signal operations:

### 6.1 Authentication & Organization Scoping
- **Never Query Without Org Filter:** Every read and write to `event_primitives` or `signal_harvest_feeds` must be scoped by `organizationId`.
  ```typescript
  // Canonical pattern:
  import { getOrgConditions } from "@server/utils/org-conditions.js";
  const conditions = getOrgConditions(authContext, eventPrimitives);
  const events = await db.select().from(eventPrimitives).where(and(...conditions));
  ```
- **Webhook Channel Verification:** Each ingress channel is assigned a unique UUID and linked to an `organizationId`. Calls to `/api/signals/ingress/events/:feedId` authenticate the feed ID against the database and enforce tenant isolation automatically.

### 6.2 Secret Encryption
- Credentials for external feeds (API keys, Basic Auth headers, OAuth tokens) must be encrypted using `encrypt()` from `@server/utils/encryption.js` and stored in `encrypted_credentials`.
- Never return decrypted API keys or passwords in client-facing settings responses.

---

## 7. Testing & Verification Checklist

Before opening a pull request or deploying changes to Signal Studio:

1. **Unit Testing:**
   - Test JSONPath extraction across nested structures, array indexing, and fallback literals in [`event-jsonpath-mapper.test.ts`](../../server/domain/signal-intelligence/tests/event-jsonpath-mapper.test.ts).
   - Test route handlers and validation errors in [`event-ingress-routes.test.ts`](../../server/domain/signal-intelligence/tests/event-ingress-routes.test.ts).
2. **Component Testing:**
   - Verify React UI components under Vitest:
     ```bash
     npx vitest run client/src/modules/signal-studio/JsonPathSchemaMapper.test.tsx
     npx vitest run client/src/modules/signal-studio/SignalStudioPod.test.tsx
     ```
3. **Lint & Gates:**
   - Pass the global verification suite:
     ```bash
     npm run check          # Full TypeScript check (0 errors)
     npm run lint:theme     # Zero hardcoded palette colors
     npm run check:migration-journal # Database migrations in sync
     ```
