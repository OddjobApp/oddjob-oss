# Prospecting Engine & Co-pilot

The Prospecting Engine is Oddjob's Zero-Party data capability, designed to observe anonymous web traffic, resolve identities (Federated Identity Merging), and actively intervene using the AI Co-pilot. It is registered as a **System App** in the Oddjob Marketplace.

## Orchestration & Marketplace
- **App Slug**: `prospecting`
- **Registration**: Seeded via `server/seed.ts` or `server/scripts/register-prospector-app.ts`.
- **Management Bridge**: Accessible via Mini-Apps → Installed Apps → Manage, featuring a dedicated **"Launch Dashboard"** action for high-intensity tracking management.

## Core Concepts

### 1. The Javascript Harness (`oddjob-prospector.js`)
A headless tracker embedded on client websites.
- **Batched Ingestion**: Buffers events and uses `navigator.sendBeacon()` or `fetch` to flush them in batches, reducing network overhead.
- **Spatial Awareness**: Can highlight DOM elements using `oj-hilight-target` to guide users.
- **Identity Storage**: Stores an anonymous `oj_prospect_id` cookie. Respects `oj_opt_out` cookies for privacy.

### 2. Multi-Property Tracking (`prospect_properties` table)
Organizations can manage multiple properties (domains) within a single Oddjob instance.
- **Property UID**: Unique identifier passed from the JS Harness to attribute traffic.
- **Settings**: Defines allowed domains and opt-out configurations per property.

### 3. Asynchronous Event Pipeline
High-throughput event ingestion bypasses synchronous database locks.
1. `POST /api/prospecting/events` receives batched events.
2. Events are immediately pushed to the `oddjob-prospecting` Redis queue managed by BullMQ.
3. The API responds with `202 Accepted`.
4. `ProspectingWorker` nodes process the queue asynchronously, executing `prospectingService.processEvent`.

### 4. Federated Identity Merging (`/api/prospecting/identify`)
The "Identity Bridge" connects anonymous traffic to known users.
- When a user logs in, clicks an email link with tracking parameters (`oj_uid`, `oj_email`), or provides an email, the JS harness calls the identify endpoint.
- All historical events tied to the anonymous `prospectUid` are transferred to a permanent Known Profile.
- Returns a `masterUid` to ensure all devices converge on a single identity.

### 5. Zero-Party De-anonymization (Reverse IP / MCP)
The architecture supports instantaneous, asynchronous discovery of anonymous visitors purely through IP resolution.
1. The JS Harness posts the event.
2. The `POST /events` Deep Module router extracts the caller's secure `originalIp`.
3. The `DeAnonymizationService` maps the IP to connected `McpClientServices` searching for valid enrichment tools (e.g., `clearbit-enrich_ip` or `zoominfo-reverse_ip`).
4. If the MCP Server resolves the Company Name and Metadata, it is lazily appended to `prospect_profiles.metadata.company` for immediate frontend availability.

### 6. AI Co-pilot Interventions
When events are processed, the S.C.O.R.E. (BANT) evaluation may decide to trigger an intervention.
- The `intervention` object dictates UI actions (e.g., `concierge_prompt`).
- The JS harness renders these interventions asynchronously based on real-time evaluation or WebSockets (in Phase 3).

### 7. Engagement Timeline UI
A high-fidelity activity feed for Sales and support teams.
- **Visual Chronology**: Renders page views, clicks, and dwell events with accurate timestamps.
- **Payload Inspection**: Allows teams to view the raw JSON data associated with any click or form interaction.
- **Real-time Synchronization**: The UI leverages React Query for seamless identity refresh as prospects move across properties.

## Data Schema Hierarchy

1. **prospect_properties**: The domain being tracked.
2. **prospect_profiles**: The identity of the visitor (Anonymous or Known).
3. **prospect_leads**: The S.C.O.R.E. attributes and aggregate data for a profile on a property.
4. **prospect_events**: Raw interaction logs (clicks, scroll depth, dwell time).

## Integration with Agent Context Injection
The current active `prospectUid` can be injected into the context of Oddjob Chat Agents. This "Cross-Session Memory" allows the agent to recall what pages the user visited or what issues they encountered before opening the chat, enabling seamless support or sales continuity.
