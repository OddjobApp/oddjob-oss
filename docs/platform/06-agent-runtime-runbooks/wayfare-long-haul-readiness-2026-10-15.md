# Wayfare long-haul readiness review — 2026-10-15

## Scope and outcome

App 799 (`wayfare`), organization 342 deployment 811, Project Space 3. The original road-trip demonstration is being converted to a durable CREW planning workspace for commercial trucks and cross-country passenger/commercial EVs. This is planning software, not navigation, dispatch clearance, a charger reservation system, or an hours-of-service compliance engine.

## Practical audit and flow

1. **Entry and startup — defective in original.** App Detail displayed Published while the runtime was offline. Starting eventually completed after a long spinner. Evidence: `artifacts/wayfare-review-2026-10-15/01-startup.png`.
2. **Original planning screen — demonstration data.** The live app showed a fixed Chicago–New York corridor, fictional people/chat/votes, fixed distances and elevation, and an inert GPX button. Source also emitted timer-driven fake mission progress. Evidence: `02-original-demo.png` in the same folder. These paths have been retired from the mounted surface; the old mission endpoint returns HTTP 410 and no executed-success claim.
3. **CREW mounting — runtime ownership defect.** Multiple persisted running instance rows pointed unrelated apps at ports 10009/10002. An SDLC-labelled frame displayed Wayfare. Preview routing now verifies actual process/container liveness; occupied ports alone cannot be adopted as a specific app. Unknown local processes fail closed and can be relaunched on another port. Safe orphan adoption across server restarts remains a separate operational concern.
4. **Current UI acceptance — exercised in CREW.** The rebuilt app mounts with the correct identity and room-scoped saved trips. A saved EV journey calculated three real legs, displayed the Mapbox map and arrival SOC/charging table, and highlighted the selected second leg. Structured provider errors now display an actionable entitlement message instead of `[object Object]`; EV mode hides combustion refill fields. Evidence: `05-selected-ev-leg.png`, `06-ev-verified-ui.png`.
5. **CREW handoff — executed read-only acceptance.** Review in CREW prepared an app-specific draft without sending. A subsequent explicit acceptance request produced successful `read_app_records` calls for the trip and journey receipt. Copilot and GhostWriter correctly reported revision 1, three legs, 345 Wh/mile, arrival SOC 51.50% / 43.89% / 23.90% and unverified charging. Evidence: `crew-grounding.log`. The generated prose was truncated, a separate CREW response-length issue; use the complete receipt as evidence.
6. **Downloads — remaining browser acceptance limit.** The iframe lacked `allow-downloads`; that omission is fixed. GPX generation and escaping are tested, but the in-app browser download observer still timed out after this correction. The export notice now says download requested rather than claiming completion. Actual downloaded-file acceptance is outstanding.

## Implemented contract

- Saved trip identity, org/deployment/Project Space/room authorization, optimistic versions, request replay with identical-content checks, transaction locks and persistent retry IDs.
- Ordered origin/intermediate/destination coordinates; explicit selection from permanent Mapbox geocoding; no guessed first result. Account entitlement is required for permanent storage.
- Commercial vehicle height/width/gross weight converted to Mapbox meters/metric tonnes. Length, axle limits, hazardous cargo access, permits and HOS are not certified. Provider restriction notices are shown per leg.
- Real Mapbox Directions road geometry, separate leg distances/durations and selectable colored legs. Cross-country requests are chunked into overlapping batches of at most 25 coordinates, preserving all intermediate legs.
- Combustion: capacity, departure fuel, reserve, weighted measured MPG, conservative reduction, per-leg fuel use/arrival/refill, below-reserve/impossible/overfill warnings. Measurements must represent consumption over the same distance interval, not an arbitrary partial fill.
- EV: usable battery kWh, departure/reserve SOC, weighted measured Wh/mile, conservative consumption increase, passenger versus commercial class, vehicle charging cap, connector and user-confirmed charging access. Per-leg SOC and planned battery energy additions; charging time uses capped charger/vehicle power, an entered average-power factor and efficiency. Unknown charging power makes total charging time incomplete.
- Mapbox EV Charge Finder connector-filtered discovery samples three points on a selected leg. Candidates are unconfirmed, may add detours, and require saving/re-routing. Search is not exhaustive; availability/access/payment/adapters require operator verification.
- Org Mapbox credential 307 was imported from the existing environment after the user's direction. Only public `pk.` tokens may reach the browser. Secret tokens and foreign-org credentials are rejected. Credentials are never printed into evidence or source files.
- Server-written `wayfare_journey_receipts` contain trip version, provider timestamp, per-leg summary and computed fuel/EV forecast. Geometry is not duplicated in durable receipts. Generic dataset/agent mutations cannot forge or edit trips/receipts. CREW selection points to the receipt after routing; Discuss prepares a chat draft without sending or executing automatically.
- GPX exports actual coordinate-bearing waypoints, with XML escaping; it does not fabricate a driving track.

## Provider acceptance evidence

Live Directions and permanent Geocoding succeeded with organization 342's stored credential. A controlled California truck journey returned three real road legs (~394 miles for the truck constraints). Entered test MPG 6 with a 10% reduction produced 5.4 forecast MPG and ~73 US gallons. These are acceptance assumptions, not user vehicle telemetry.

Passenger EV routing over the same public city waypoints succeeded. Controlled 100 kWh battery, 90% departure / 15% reserve, measured 300 Wh/mile and 15% uplift produced 345 Wh/mile and ~217 miles departure range above reserve. Hypothetical charging additions were explicitly left unconfirmed. Logs: `live-route.log`, `live-geocode.log`, `live-ev.log` in the artifact folder.

A live Los Angeles–New York route returned approximately 2,778 miles. With no charging stops, the EV model correctly rejected energy feasibility and flagged the leg unreachable. This checks coast-to-coast geometry and energy shortfall detection; it does not establish a verified charging itinerary. Evidence: `live-cross-country.log`.

**Charger discovery is externally blocked:** Mapbox EV Charge Finder returned HTTP 401 for this token. Maps, Directions and Geocoding access do not imply this separate private-preview entitlement. Manual verified charging plans and range calculations remain usable; do not claim automatic cross-country charging coverage or live availability.

## Verification status

- Focused tests cover fuel and EV arithmetic, XML, Mapbox unit conversions, stale routes, provider failure, cross-country leg batching, public-token/org boundaries, CREW message origin/room checks and runtime ownership.
- Real migrated test PostgreSQL tests cover saving/reload, duplicate retries, stale concurrent edits, global-template deployments, room/org isolation, protected generic writes and grounded journey receipts. Never run them against development data.
- A full `npm run verify` completed before the EV extension: 1,513 files passed / 3 skipped; 14,137 tests passed / 40 skipped, then smoke/build completed. The EV extension gate in `verify-current.log` found a routing return-type error; fixed with an explicit string-record return contract. The fresh gate is `verify-final.log`; final results must be checked before declaring readiness.
- The latest focused suite passed 42 tests across seven files; the real PostgreSQL suite passed five tests. Next production build passed in `blueprint-build-release.log`, with strict TypeScript checking. No public publication/access policy was expanded. The final GPX notice/anchor correction also passed the strict Next build (`blueprint-build-gpx.log`) and was activated for deployment 811. The final repository gate has passed TypeScript and is running unit tests.

## Limits / follow-up acceptance

Actual GPX download and the final full repository gate remain outstanding. The final live GPX retry displayed the honest download-request notice, but the in-app browser did not report a download event within ten seconds; no downloaded file has been confirmed. Save/reload/concurrent-edit behavior is covered by real PostgreSQL tests; exhaustive browser reorder/keyboard and accessibility acceptance is not established from screenshots. EV Charge Finder access needs a Mapbox account entitlement; it is not an app permission that can be bypassed. There is no vehicle telemetry ingestion, calibrated weather/elevation/thermal energy model, automatic charging optimization, station booking, or guaranteed truck-legal route.

Primary references: [Mapbox Directions](https://docs.mapbox.com/api/navigation/directions/), [Geocoding storage](https://docs.mapbox.com/api/search/geocoding/), [public access tokens](https://docs.mapbox.com/help/getting-started/access-tokens/), [EV Charge Finder private preview](https://docs.mapbox.com/api/navigation/ev-charge-finder/).
