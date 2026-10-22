# Public product screenshots

The homepage and overview use `ProductScreenshots` to show captures from the
running Oddjob application. These are browser screenshots, not generated mockups.

| Asset | Source | What it demonstrates |
| --- | --- | --- |
| `client/public/images/product/crew-form.png` | Dedicated Oddjob demo room `crew-public-demo-form-compact-20261021` | An agent-generated interactive bug-report form in CREW |
| `client/public/images/product/crew-checklist.png` | Dedicated Oddjob demo room `crew-public-demo-plan-20261021` | A real rendered table using fictional launch-planning data |
| `client/public/images/product/published-form.png` | `/a/oddjob-announcements?embed=1` | The published announcements form with email and explicit consent |

The room contains only demonstration prompts and sample content. The published
form capture has no email entered and consent is unchecked. Neither screenshot
demonstrates an external send, a submitted report, or a completed subscription.
Do not use private inbox content, customer data, credentials, or permission
settings as public marketing assets.

To refresh a capture, use the real application, inspect the complete visible
content, and save the browser screenshot. Crop only to focus the capture; do not
reconstruct or alter product controls or execution results. Keep the image's
intrinsic dimensions in `ProductScreenshots` in sync with the replacement. All
screenshots can be opened at full size from the public pages.

## Rescue Dispatch App Forge showcase

`rescue-dispatch.png` is a browser capture of the actual blueprint dashboard and
map components, mounted locally with Vite. The preview serves the blueprint's own
MOCK_SQUADS, MOCK_RESCUES, and MOCK_PROVIDERS through its collection endpoints.
Non-GET API calls return 403: no dispatch, pipeline execution, email, or operational
record was created. An explicit preview banner is included in the capture.

Request selection, map focus, and the selected-request panel were checked in the
browser. The blueprint map uses MapLibre 4 (compatible with react-map-gl 7) and
public OpenStreetMap raster tiles, with attribution; satellite mode uses Esri.
Mapbox credentials are not required. Public tile-provider usage policies still
apply to deployments; configure a suitable tile service for sustained traffic.

The public `/app/rescue-dispatch` route was stuck loading at capture time and had
no running Forge runtime recorded. The showcase links to source rather than that
route. It does not claim a deployed emergency service or verified dispatch actions.

## Capability demonstrations (2026-10-22)

The five capability cards on the homepage and overview use these captures:

| Asset | Source | Evidence and limitations |
| --- | --- | --- |
| `durable-missions.jpg` | `/missions/1/runs/1?orgId=1`, Developer Mode / Activity | Saved demo mission 1 and run 1, explicitly paused; no pipelines executed |
| `app-forge.jpg` | CREW `crew-1792681840650-p4jxk9s?studio=forge&orgId=1` | Actual specification UI with fictional requirements; generation was not started |
| `organizational-knowledge.jpg` | Knowledge Store, document 2 | Synthetic playbook uploaded through the normal UI; cropped to the library and demo row, excluding other document content |
| `approvals-replay.jpg` | Actual TimelineTab rendered in an isolated read-only UI preview | Data captured from the org-scoped evidence API for demo run 1, with payloads excluded; only real creation/pause events, no invented approvals or computer-use history |
| `spatial-intelligence.jpg` | `/operations/spatial?orgId=1`, H3 palette | Map-detail crop of a draft sample selection on Esri satellite imagery; no Apply action |

Mission/run records are explicitly named DEMO. Run context has `demo: true`,
`seeded: true`, `environment: demo`, and `source: public-showcase-demo`, so it is
classified as synthetic evidence rather than production reliability evidence.
The run was created with no pipeline sequence and paused without execution.
No approval requests, notification jobs, external communications, or dispatches
were created. The knowledge document contains only fictional operational guidance.

The Timeline tab now loads the existing org-scoped evidence endpoint instead of
displaying a Gantt placeholder. Its local capture is labeled as a read-only UI
preview. Captions distinguish demonstrated functionality from unexercised actions.

The spatial image is a focused browser crop of the captured map, excluding a
transient help tooltip over the side controls. Imagery attribution is included in
the public caption, using the provider's service metadata:
https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer?f=pjson

Rescue map correction: the public showcase uses rescue-dispatch-map.jpg, a viewport capture with the complete map and attribution visible. Removed the map child minimum height that exceeded its parent; avoided the full-page WebGL capture that clipped rendered tiles. The earlier full-page asset is retained only as history.

Spatial geographic rules demo: SpatialRulesDemo replaces the static crop on the public pages. It uses real h3-js cell membership over a fictional Los Angeles service area, a deny-first restricted cell, and three synthetic request centroids. All evaluation stays in the browser. The human review step is explanatory; no approval or dispatch is executed. OpenStreetMap raster tiles retain contributor attribution. The previous satellite capture remains an archival asset.

## Recurring-work examples

The use-cases page includes three full-width captures from a disconnected local preview of the actual repository components, with a visible synthetic-data banner. Fixtures exist only in preview memory; no production records, credentials, schedules, or executions were created.

- `recurring-pipeline.jpg` (1280×720): `PipelineCanvas.tsx`, with API intake → AI summary → human approval. No execution results supplied.
- `recurring-schedules.jpg` (1274×717): the mounted schedule-rules `Schedules.tsx`, with three disabled QueryClient fixtures in America/Los_Angeles. All API access is disconnected.
- `recurring-cycle.jpg` (1280×720): `CycleGanttChart.tsx`, with five draft phases, dependencies and an owner sign-off milestone. No actual run data supplied; Zoom to fit used.

Captures are unaltered viewport screenshots, not full-page WebGL captures. The public captions distinguish UI previews from live operational evidence.
