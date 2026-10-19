# Signal Studio Industry Packs & Available Signals Best Practices

> **Status:** Active  
> **Audience:** Solution Architects, Operations Leads, Autonomous Agent Operators, Platform Engineers  
> **Architectural Tier:** Layer 0 (Telemetry & Ingress) & Layer 1 (Industry Solution Layer) in Oddjob's 5-Layer AI Control Plane  
> **Related Specifications:**
> - [Signal Studio Feature Documentation](../feature-documentation/signal-studio.md)
> - [Signal Studio Best Practices](./signal-studio-best-practices.md)
> - [Signal Studio General Purpose Harvesting Proposal](../proposals/SIGNAL_STUDIO_GENERAL_PURPOSE_HARVESTING_PROPOSAL.md)
> - [Universal Event Envelope Specification](../UNIVERSAL_EVENT_ENVELOPE.md)
> - [Signal Intelligence Spatial Rules](../SIGNAL_INTELLIGENCE_SPATIAL_RULES.md)

---

## 1. Executive Summary & Purpose

Signal Studio serves as Oddjob's **Layer 0 Event Harvesting and Ingestion Engine**. Rather than embedding hardcoded vertical domain rules into the core spatial map or telemetry bus, Signal Studio uses **Modular Industry Solution Packs** to configure specialized ingestion channels, schema mappings, alert criteria, and downstream operational playbooks.

This guide provides an end-to-end operational and architectural manual for:
1. **Available Signals by Industry**: A deep-dive catalogue of out-of-the-box signals across all 7 default Industry Packs.
2. **Signal Ingestion & Spatial Encoding**: How raw payloads are harvested, mapped via JSONPath, and encoded into Uber H3 hexagonal spatial indexes.
3. **Downstream Operational Hand-off**: How harvested signals automatically convene **CREW Deliberation Rooms**, trigger **Flow Studio Pipelines**, and pause at **Human-In-The-Loop (HIL)** governance gates.
4. **Authoring Custom Industry Packs**: Standards, schemas, and best practices for creating and registering new domain packs.

---

## 2. Industry Packs Architecture in the 5-Layer Control Plane

Industry Packs sit cleanly between the general-purpose ingestion substrate and autonomous operational execution:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                        ODDJOB 5-LAYER AI CONTROL PLANE: SIGNAL PACK PLACEMENT                          │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Layer 4: Human-in-the-Loop (HIL) Governance                                                            │
│   • Acquisition Offer Approval Gates, Emergency Mitigation Waivers, Capital Allocation Sign-Offs       │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Layer 3: Autonomous Orchestration & CREW Deliberation                                                  │
│   • CREW Multi-Agent Deliberation Rooms (e.g., 4-Stage Distressed Acquisition Assembly)                │
│   • Flow Studio DAG Execution (e.g., Automated Loan Tape Underwriting, Supplier Rerouting RFP)         │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Layer 2: Real-Time World Model & Causal Graph                                                          │
│   • Cross-Signal Entity Correlation, Multi-Jurisdiction Geofence Breaches, Temporal Velocity Tracking   │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Layer 1: Modular Industry Solution Packs (Domain Configuration Layer)                                  │
│   • Pre-configured Feed Presets, Expected Signal Enums, CEL Filter Predicates, Downstream Playbooks   │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Layer 0: Pluggable Signal Harvesting Engine (Signal Studio Platform)                                   │
│   • Universal Ingress (Webhooks, REST Pollers, RSS/Atom, Computer Use Scrapers, Spatial Kafka)         │
│   • Visual JSONPath Schema Mapper, Dynamic Uber H3 Res-7 Spatial Encoder, SHA-256 Content Deduplication│
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Catalog of Available Signals by Industry Pack

Oddjob ships with 7 pre-built Industry Solution Packs configured in [`client/src/modules/signal-studio/industry-packs.ts`](../../client/src/modules/signal-studio/industry-packs.ts). Each pack bundles specialized data feeds, expected signal classifications, extraction rules, and recommended operational playbooks.

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 AVAILABLE INDUSTRY PACKS MATRIX                                       │
├──────────────────────────┬─────────────────────────────────────┬───────────────────┬──────────────────┤
│ Industry Pack ID         │ Primary Target Persona              │ Domain Sector     │ Default Interval │
├──────────────────────────┼─────────────────────────────────────┼───────────────────┼──────────────────┤
│ `residential_distress`   │ Head of Acquisitions / Underwriting │ Real Estate       │ 300s - 3600s     │
│ `supply_chain`           │ VP of Supply Chain / COO            │ Maritime & Freight│ 300s - 900s      │
│ `regulatory`             │ General Counsel / Chief Compliance  │ Legal & Policy    │ 900s - 3600s     │
│ `macroeconomic`          │ Chief Financial Officer / Treasury  │ Banking & Finance │ 900s - 1800s     │
│ `cyber_cloud`            │ CISO / VP of Infrastructure         │ Cybersecurity/SaaS│ 300s - 1800s     │
│ `weather_grid`           │ VP of Facilities / Operations       │ Energy & Utilities│ 600s             │
│ `competitor_corp`        │ Head of Strategy / M&A Lead         │ Corporate Dev     │ 900s - 1800s     │
└──────────────────────────┴─────────────────────────────────────┴───────────────────┴──────────────────┘
```

---

### Pack 1: Residential Real Estate Distress & Acquisition Pack (`residential_distress`)

- **Primary Persona:** Head of Acquisitions / Special Situations Underwriter
- **Business Value:** Proactively captures distressed residential opportunities (pre-foreclosure, tax delinquency, code violations) and auto-generates preliminary loan tapes and Subject-To underwriting models prior to public trustee auction.
- **Default Playbook:** Convene the **Residential Real Estate Distress Assembly** in CREW chat with a mandatory Human-In-The-Loop offer sign-off gate.

#### Available Signals & Feeds

| Signal Name | Source Type | Default Endpoint / Feed | Expected Interval | Severity | Key Extracted Attributes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Notice of Default (NOD)** | `geo_spatial` | County Recorder Recorder Ingress Stream | 300s | `high` / `critical` | `apn`, `recordedDate`, `defaultAmount`, `trusteeName`, `beneficiary`, `originalLoanAmount` |
| **Pre-Foreclosure Filing / Lis Pendens** | `geo_spatial` | County Superior Court Filings Feed | 300s | `high` | `courtCaseNumber`, `plaintiff`, `defendant`, `propertyAddress`, `recordingBookPage` |
| **Scheduled Trustee Foreclosure Auction** | `public_records` | County Auctioneer Master Feed | 600s | `critical` | `auctionDate`, `auctionTime`, `minimumOpeningBid`, `auctionLocation`, `publicationDate` |
| **Delinquent Property Taxes & Liens** | `tax_assessor` | County Treasurer-Tax Collector Delinquency Roll | 3600s | `medium` / `high` | `apn`, `delinquentTaxYears`, `unpaidAmount`, `penaltiesAmount`, `installmentStatus` |
| **Substandard / Red-Tag Housing Citation** | `code_enforcement` | Municipal Building & Safety Inspection RSS | 1800s | `high` | `caseId`, `violationCode`, `isOccupied`, `repairDeadline`, `isRedTagged` |

#### Sample Ingestion Payload & Extracted Envelope
```json
{
  "source": "orange_county_recorder",
  "documentType": "NOTICE_OF_DEFAULT",
  "filing": {
    "recordingNumber": "202600049281",
    "filingDate": "2026-09-28T16:15:00Z",
    "property": {
      "street": "14282 Newport Ave",
      "city": "Tustin",
      "state": "CA",
      "zip": "92780",
      "apn": "501-122-04",
      "lat": 33.7456,
      "lng": -117.8262
    },
    "debt": {
      "defaultArrearsUsd": 42850.00,
      "unpaidPrincipalBalance": 485000.00,
      "originalLoanAmount": 520000.00,
      "interestRate": 0.0325,
      "lender": "Wells Fargo Bank, N.A."
    }
  }
}
```
**JSONPath Extraction Mapping:**
- Title: `$.filing.documentType` + ` - ` + `$.filing.property.street`
- Coordinates: Lat: `$.filing.property.lat`, Lng: `$.filing.property.lng`
- Uber H3 Index: Auto-computed to `872834714ffffff` (Resolution 7)
- Metadata Bag: `apn: $.filing.property.apn`, `defaultAmount: $.filing.debt.defaultArrearsUsd`, `interestRate: $.filing.debt.interestRate`

---

### Pack 2: Global Supply Chain & Logistics Pack (`supply_chain`)

- **Primary Persona:** VP of Global Supply Chain / Chief Operating Officer
- **Business Value:** Monitors maritime chokepoints, container freight spot rates, terminal labor disruptions, and port congestion to flag supply commitments at risk before downstream manufacturing lines halt.
- **Default Playbook:** Recalculate production delivery milestones in Flow Studio and initiate an automated supplier rerouting RFP.

#### Available Signals & Feeds

| Signal Name | Source Type | Default Endpoint / Feed | Expected Interval | Severity | Key Extracted Attributes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Maritime AIS Vessel Telemetry** | `geo_spatial` | Satellite AIS Live Corridor Stream | 300s | `medium` | `mmsi`, `imo`, `vesselName`, `destinationPort`, `eta`, `speedKnots`, `draughtMeters` |
| **Port Congestion & Berth Dwell Time** | `geo_spatial` | Major Port Authority Dwell Telemetry | 300s | `high` | `portCode` (e.g. `USLAX`), `anchoredVesselCount`, `meanDwellDays`, `craneUtilizationPct` |
| **Canal Chokepoint Disruption** | `rest_api` | Canal Authority Operational Bulletin | 600s | `critical` | `canalId` (e.g. `panama`, `suez`), `dailyTransitSlots`, `draftLimitFeet`, `backlogVesselCount` |
| **Global Carrier Blank Sailings & Strikes** | `rss` | FreightWaves / Journal of Commerce RSS | 900s | `high` | `carrierName`, `serviceLoop`, `omittedPorts`, `strikeActionStatus`, `affectedTeu` |

#### Operational Trigger Example
- **Predicate Expression:** `signal.category == 'Supply Chain Disruption' && signal.attributes.dwellDays > 5.0 && spatial.within_geofence('port_of_los_angeles')`
- **Dispatched Action:** Posts urgent briefing to `#ops-war-room` CREW chat, seats the *Supply Chain Quartermaster* agent, and initiates the air-freight conversion assessment.

---

### Pack 3: Regulatory, Sanctions & Trade Policy Pack (`regulatory`)

- **Primary Persona:** General Counsel / Chief Compliance Officer (CCO)
- **Business Value:** Monitors government gazettes, sanctions roll updates, tariff modifications, and cross-border digital mandates in real time to prevent regulatory exposure and illegal entity transactions.
- **Default Playbook:** Auto-screen master vendor and customer database against updated OFAC entries and file an RFC in Scribe Studio.

#### Available Signals & Feeds

| Signal Name | Source Type | Default Endpoint / Feed | Expected Interval | Severity | Key Extracted Attributes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC EDGAR Material Filings (8-K / 10-K)** | `sec_filing` | SEC EDGAR Real-Time Atom Feed | 900s | `high` | `cik`, `companyName`, `formType`, `itemsCovered`, `accessionNumber`, `filingUrl` |
| **OFAC Specially Designated Nationals (SDN)**| `rest_api` | U.S. Treasury Sanctions List Stream | 900s | `critical` | `entityName`, `entityType`, `program`, `identificationNumbers`, `knownAddresses` |
| **USTR Section 301 / Tariff Changes** | `trade_policy`| U.S. Trade Representative Press Releases | 3600s | `high` | `tariffHarmonizedCode`, `newAdValoremRate`, `effectiveDate`, `originCountry` |
| **European Union Regulatory Directives** | `eu_legislative`| EUR-Lex Official Journal / Commission RSS| 3600s | `medium` / `high` | `directiveNumber`, `legalBasis`, `complianceDeadline`, `subjectScope` (e.g. `AI Act`) |

---

### Pack 4: Macroeconomic & Central Banking Pack (`macroeconomic`)

- **Primary Persona:** Chief Financial Officer / Head of Treasury
- **Business Value:** Tracks central bank policy statements, interest rate revisions, yield curve inversions, and liquidity shifts to protect operating margins and forecast refinancing expenses.
- **Default Playbook:** Update corporate Weighted Average Cost of Capital (WACC) model in Flow Studio and convene a Treasury Hedging review in CREW chat.

#### Available Signals & Feeds

| Signal Name | Source Type | Default Endpoint / Feed | Expected Interval | Severity | Key Extracted Attributes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Federal Reserve FOMC Bulletins & Rates** | `central_bank` | Federal Reserve Board Press RSS | 1800s | `critical` | `targetRateUpper`, `targetRateLower`, `rateDeltaBps`, `voteSplit`, `statementSummary` |
| **Treasury Yield Curve & SOFR Benchmarks** | `rss` | MarketWatch / Financial Times Top Stories | 900s | `medium` | `benchmarkTenor` (e.g. `10Y`, `2Y`), `yieldPct`, `yieldSpreadBps`, `sofrRate` |
| **Consumer Price Index (CPI) & Inflation** | `rest_api` | Bureau of Labor Statistics (BLS) Release | 3600s | `high` | `headlineCpiPct`, `coreCpiPct`, `monthOverMonthPct`, `primaryContributors` |

---

### Pack 5: Critical Cloud & Cybersecurity Resilience Pack (`cyber_cloud`)

- **Primary Persona:** Chief Information Security Officer (CISO) / VP of Infrastructure
- **Business Value:** Surfaces major public cloud provider degradations, critical zero-day software vulnerabilities, and third-party SaaS disruptions before enterprise users report outages.
- **Default Playbook:** Trigger multi-region disaster recovery DNS failover and assemble the Incident Response CREW.

#### Available Signals & Feeds

| Signal Name | Source Type | Default Endpoint / Feed | Expected Interval | Severity | Key Extracted Attributes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **CISA Known Exploited Vulnerabilities (KEV)**| `rss` | CISA Cybersecurity Advisories XML | 1800s | `critical` | `cveId`, `vendorProject`, `vulnerabilityName`, `dateAdded`, `requiredActionDeadline` |
| **Public Cloud Infrastructure Status** | `rest_api` | AWS / GCP / Azure Incident Feeds | 300s | `high` / `critical` | `cloudProvider`, `region`, `serviceName`, `incidentState`, `impactDescription` |
| **SaaS & API Gateway Health Telemetry** | `rest_api` | External Synthetic Ping / StatusPage RSS| 300s | `high` | `targetVendor` (e.g. `Stripe`, `Auth0`), `httpStatus`, `latencyMs`, `degradedComponents` |

---

### Pack 6: Severe Weather & Energy Grid Resilience Pack (`weather_grid`)

- **Primary Persona:** VP of Operations / Real Estate Facility Director
- **Business Value:** Geofence-correlates severe weather hazards (hurricanes, tornadoes, flash floods) and electrical grid stress indicators with physical corporate facilities and data centers.
- **Default Playbook:** Execute facility emergency shutdown checklist and shift mission-critical compute workloads to secondary regions.

#### Available Signals & Feeds

| Signal Name | Source Type | Default Endpoint / Feed | Expected Interval | Severity | Key Extracted Attributes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **NWS Common Alerting Protocol (CAP)** | `rss` | National Weather Service Hazards Feed | 600s | `high` / `critical` | `eventUrgency`, `eventSeverity`, `polygonCoordinates`, `headline`, `expiresEpoch` |
| **Regional Power Grid Stress & EEA Alerts** | `rest_api` | ISO / RTO Operational Status (CAISO/ERCOT)| 300s | `critical` | `gridOperator`, `energyEmergencyAlertLevel` (EEA 1-3), `reserveMarginPct`, `curtailmentRisk` |
| **Wildfire Perimeter & Air Quality Indices** | `geo_spatial` | GeoMAC / EPA AirNow Hazard Stream | 1800s | `high` | `fireName`, `containmentPct`, `acresBurned`, `aqiScore`, `spatialPerimeterPolygon` |

---

### Pack 7: Corporate Filings & Competitor Watchlist (`competitor_corp`)

- **Primary Persona:** Head of Corporate Strategy / Corporate Development Lead
- **Business Value:** Tracks competitor acquisitions, stealth venture funding rounds, executive departures, restructuring announcements, and patent grants to identify threats and M&A opportunities weeks ahead of mainstream coverage.
- **Default Playbook:** Draft competitive impact counter-brief in Scribe Studio and alert Product and Sales leadership.

#### Available Signals & Feeds

| Signal Name | Source Type | Default Endpoint / Feed | Expected Interval | Severity | Key Extracted Attributes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TechCrunch Venture & M&A Wire** | `rss` | TechCrunch RSS Feed | 900s | `medium` | `articleTitle`, `targetCompany`, `roundSizeUsd`, `leadInvestors`, `valuationUsd` |
| **Grassroots Industry Intelligence** | `reddit` | Curated Industry Subreddit RSS | 1800s | `low` / `medium` | `subredditName`, `upvoteVelocity`, `postTitle`, `mentionedCompetitor`, `sentimentScore` |
| **USPTO Published Patent Grants** | `rest_api` | USPTO Patent Examination API | 3600s | `medium` | `patentNumber`, `assigneeName`, `patentTitle`, `abstractText`, `cpcClassification` |

---

## 4. End-to-End Workflow: Ingress to Execution

Here is the operational lifecycle of a signal arriving through an activated Industry Pack:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                SIGNAL LIFECYCLE & EXECUTION PIPELINE                                   │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
    1. INGESTION & PARSING
       ├── Feed Poller pulls external source or Webhook receives HTTP POST (`/api/signals/ingress/events/:feedId`)
       └── Raw JSON body is stored in `event_primitives.rawPayload` for forensic auditability
    
    2. NORMALIZATION & MAPPING
       ├── EventJsonPathMapper extracts canonical fields (title, summary, category, severity, timestamp)
       └── Latitude / Longitude extracted and validated against WGS-84 ranges [-90,90] and [-180,180]

    3. SPATIAL HEXAGONAL ENCODING
       ├── Uber H3 encoder derives resolution-7 hexagon index (e.g. `872834714ffffff`)
       └── SHA-256 content hash computed across payload to prevent duplicate processing

    4. WORKBENCH & SPATIAL RADAR
       ├── Event lands in `SignalsDecisionsWorkbench` live stream with interactive JSON payload drawer
       └── Spatial marker renders on `SpatialCanvasBlock` with category-specific icon & color badge

    5. PREDICATE EVALUATION & ACTION DISPATCH
       ├── Evaluates CEL rule (e.g. `signal.severity == 'critical' && signal.attributes.defaultAmount > 25000`)
       ├── Posts alert card to active CREW room or initializes new Deliberation Room
       └── If high-risk capital decision: mounts Human-In-The-Loop (HIL) form before workflow executes
```

---

## 5. Authoring Custom Industry Packs

To register a new vertical solution pack, adhere to the standard TypeScript contract defined in [`client/src/modules/signal-studio/types.ts`](../../client/src/modules/signal-studio/types.ts):

### Step 1: Define the Pack Interface
```typescript
import type { LucideIconName } from '@/components/ui/icons';

export interface FeedPreset {
  name: string;
  sourceType: 'rss' | 'rest_api' | 'geo_spatial' | 'public_records' | 'sec_filing' | 'code_enforcement' | 'tax_assessor';
  url: string;
  expectedSignals: string[];
  recommendedIntervalSeconds: number;
  description: string;
  defaultMapping?: Record<string, string>;
}

export interface IndustryPack {
  id: string;
  name: string;
  targetRole: string;
  badge: string;
  accentColor: string; // Tailwind semantic color string
  iconName: LucideIconName;
  description: string;
  businessValue: string;
  defaultPlaybook: string;
  feeds: FeedPreset[];
}
```

### Step 2: Implement Robust JSONPath Mappings
When authoring feed presets, supply pre-tested dot-notation or JSONPath extraction rules. Follow these best practices:
- **Use Fallbacks for Optional Fields:** Always use the `||` operator for fields that may vary between providers (e.g., `$.location.lat || $.coordinates.latitude || 33.7456`).
- **Sanitize Strings:** Map title fields to concise identifiers (less than 120 characters) to ensure readability in mobile push notifications and CREW room banners.
- **Normalize Timestamps:** Ensure the timestamp path resolves to an ISO-8601 string or epoch millisecond integer.

### Step 3: Configure Predicates in `SignalFilterBuilder`
Define clean CEL predicates that prevent notification storms:
- **Good Predicate:** `event.severity in ['high', 'critical'] && event.confidence >= 0.85 && spatial.within_distance(facility_lat, facility_lng, 25.0)`
- **Poor Predicate:** `event.title != ''` (fires indiscriminately on every background health check).

---

## 6. Multi-Tenant Governance & Security Constraints

Every signal ingested and processed must observe strict tenant boundaries:
1. **Mandatory Organization Scoping:**
   - Universal Webhook Ingress verifies that the calling route or API key resolves to an authorized `organizationId`.
   - All database reads and writes to `event_primitives` must use `getOrgConditions(authContext, eventPrimitives)`. Never write raw un-scoped queries.
2. **Cryptographic Deduplication:**
   - Ingress computes `sha256(feedId + ":" + rawBodyString)`. If a duplicate is received within the ingestion cooldown window (default: 300 seconds), it is acknowledged with HTTP 200 `{ "duplicate": true }` but discarded to prevent duplicate rounds in CREW chat.
3. **No Secret Leakage:**
   - External feed API credentials (Basic Auth passwords, Bearer tokens, private endpoints) must be encrypted using `encrypt()` and stored in `encrypted_credentials`, never committed to source files or included in client-visible JSON responses.

---

## 7. Verification & Quality Gates

Before shipping changes to Industry Packs or signal ingestion:
```bash
npm run test:unit       # Verifies event-jsonpath-mapper and ingress routes
npm run lint:theme      # Verifies zero hardcoded dark/light palette colors
npm run check           # Verifies full TypeScript compilation with zero type errors
```
