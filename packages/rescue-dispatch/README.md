# @oddjob/rescue-dispatch

**Tactical Emergency Dispatch & Incident Management Control Center**

Standalone Next.js 14 Web Application for real-time emergency dispatching, incident response coordination, and provider workspace routing powered by Oddjob's Eulerian H3 Hexagonal Spatial Engine and AIP-Style Business Ontology.

---

## Capabilities

1. **Tactical Operations Control Center (`/`)**:
   - Live interactive Mapbox GL satellite & tactical map.
   - Real-time incident triage and dynamic severity scoring.
   - Whole-squad and individual provider dispatching.
   - Live SSE event streaming from `/api/rescue/events`.

2. **Public Requester Tracking Portal (`/r/[token]`)**:
   - Real-time GPS location resolution with reverse geocoding fallback.
   - Live provider ETA and progress timeline.

3. **Provider Mobile Workspace (`/h/[token]`)**:
   - Fast token-based provider onboarding and assignment acceptance.
   - Dynamic waypoint routing and geofence checkpoint attestation.

4. **Oddjob Platform Integration**:
   - Backend API Proxy via `/api/oddjob/[...path]` forwarding authenticated requests to Oddjob services.
