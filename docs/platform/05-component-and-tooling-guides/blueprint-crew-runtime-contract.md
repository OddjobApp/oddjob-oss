---
id: blueprint-crew-runtime-contract
title: Blueprint ↔ CREW Runtime Contract
audience: [HYBRID]
badge: HYBRID
category: 05-component-and-tooling-guides
autonomy_level: L1-L3
version: 1.0.0
tags: [blueprints, crew, app-surfaces, embedded-apps, postMessage, mounted-app, surface-approval, requireLaunchedMission, crew-app-view]
summary: The contract every blueprint app under server/blueprints/apps must satisfy to launch, navigate, request input, and execute governed work as a first-class embedded surface inside a CREW room.
---

# Blueprint ↔ CREW Runtime Contract `[🤝 HYBRID]`

> **Audience:** `🤝 Hybrid: Blueprint author + Agent` &nbsp;|&nbsp; **Classification:** Runtime Contract & Authoring Standard

A blueprint app under `server/blueprints/apps/*` is not just a standalone Next.js app —
when deployed and mounted inside a CREW room it becomes a **governed embedded surface**:
it reports navigation and selection to the room, can ask the room for input or approvals,
and its mission launches and decision records are receipt-checked server-side.

`server/domain/apps/platform/blueprint-crew-contract.test.ts` is the hermetic CI gate for
this contract. It scans every blueprint directory — a new blueprint cannot silently escape
it — and it fails if any rule in this document is violated.

---

## 1. How a blueprint becomes a CREW surface

A blueprint is *mountable* only when it exists as an installed deployment for the
organization: `crewAppStudioService` lists `appDeployments` with a non-null `publicSlug`
and a status that is not failed/error/stopped/uninstalled. The deployable artifact comes
from `blueprints.manifest` in the cycle YAML (`server/cycles/*.cycle.yaml`), not directly
from the source directory — a source blueprint that was never seeded/built does not appear
in App Studio.

When the user opens **App studio** (`BlueprintStudioLauncher`) or an agent renders a
surface (`render_app_surface`), the host iframe URL is `/app/<publicSlug>` plus the embed
context query:

```
/app/<publicSlug>/<route>?embedded=true&embed=1&crewRoom=<roomKey>&crewActivity=chat&orgId=<orgId>
```

- `embedded=true&embed=1` — the app is running inside an Oddjob surface (used by app
  clients to switch to embedded behaviour).
- `crewRoom=<roomKey>` — activates the injected bridge (§2) and is the room the surface's
  `postMessage` traffic is bound to.
- `crewActivity=chat` — additionally activates the activity-feed forwarding and CREW
  presentation CSS in the bridge.
- `orgId=<orgId>` — organization scope for clients that resolve scope from the URL.

The host (`CrewCycleAppCanvas.getEmbeddedUrl`) rewrites every iframe navigation through
this convention, including Back/App-home history entries — blueprint code never needs to
preserve these parameters itself.

## 2. The injected bridge — `window.oddjobCrew`

`server/middleware/crew-app-activity-bridge.ts` is injected into every embedded app page
by the preview proxy when `crewRoom` is present. A blueprint does **not** need its own
navigation bridge — the script hooks `history.pushState`, `history.replaceState`, and
`popstate` and emits a `crew-app-view` message to the room on every route change.

The bridge exposes:

```ts
window.oddjobCrew = {
  roomKey: string,
  // Report which record the user is working on. Forwarded to the room with the next
  // crew-app-view and — after server-side verification (§4) — injected into the
  // agent's context as part of the mounted-app binding.
  setSelectedRecord(record: { collection: string; recordId: string } | null): void,
  // Re-emit the current view (e.g. after the app changed state without a URL change).
  notifyView(): void,
}
```

It also seeds selection from `?collection=<c>&recordId=<id>` / `focusId=<id>` query
parameters at load, polls `/api/oddjob/events/history` for app telemetry when
`crewActivity=chat` is set, and forwards it to the room as `crew-app-activity`.

With `crewActivity=chat` the bridge additionally applies `CREW_APP_PRESENTATION_CSS`, so
embedded surfaces match the room's visual treatment automatically.

### The Crew SDK — `server/blueprints/sdk/crew-sdk.ts`

`server/blueprints/sdk/crew-sdk.ts` is the canonical, vendorable client for this
whole contract (companion to `workbench-sdk.ts`, which covers the older Cycle
Manager protocol). It has no imports — copy it into a blueprint's `lib/` and use:

```ts
import {
  isCrewEmbedded, crewRoomKey, setSelectedRecord, notifyView,
  requestCrewInput, requestSurfaceApproval, onCrewHostEvent,
} from "../lib/crew-sdk";
```

Every helper prefers the injected `window.oddjobCrew` bridge when present and
falls back to posting the same messages itself, so apps behave identically with
or without injection. `sdlc-workbench` vendors it at
`server/blueprints/apps/sdlc-workbench/lib/crew-sdk.ts` — new blueprint surface
code should do the same instead of hand-rolling `postMessage` calls or copying
the request loop out of `lib/workbench-bridge.ts`.

## 3. Surface → room messages

All messages are `postMessage` to `window.parent` at `location.origin`. The host validates
`event.origin`, `event.source === iframe.contentWindow`, and `roomKey` before acting.

### `crew-app-view` — navigation & selection reporting

```ts
{ source: 'crew-app-view', version: 1, roomKey, pathname,
  selectedRecord?: { collection: string; recordId: string } }
```

Emitted by the bridge automatically; call `oddjobCrew.notifyView()` for SPA state changes
that do not touch the URL. `pathname` must match `/^\/[a-z0-9/-]*$/` — the host resolves
it against the deployment's public path, tolerating both logical routes
(`/qa-workbench`) and deployment-prefixed routes (`/app/<slug>/qa-workbench`).

### `crew-surface-request` — ask the room for input or an approval

```ts
{ source: 'crew-surface-request', version: 1, roomKey, requestId,
  kind: 'question' | 'form' | 'approval', title,
  fields?: Field[],            // required for 'question'/'form'
  approvalId?: number }        // required for 'approval'
```

Schema: `surfaceRequestSchema` in `shared/crew-surface-request.ts`. Rules:

- `question`/`form` carry `fields` (max 20, unique keys); `approval` carries a persisted
  `approvalId` and no fields.
- An `approval` request is only honoured if the approval is a **bound surface approval**
  — `kind === 'app_record_action'` whose `app.id` and `sessionKey` match this app and room
  (`isBoundSurfaceApproval` in `server/domain/crew/core/crew-surface-approval.ts`). An app
  cannot surface an approval that belongs to another app or room; the host fetches it
  through `GET /api/crew/<roomKey>/surface-approval/<approvalId>?orgId=<orgId>&app=<path>`
  and renders the governed card in chat.

### `crew-surface-response` — the room's answer (host → app)

```ts
{ source: 'crew-surface-response', version: 1, roomKey, requestId,
  status: 'accepted' | 'submitted' | 'cancelled', data?: Record<string, unknown> }
```

The app receives `accepted` immediately (the card is visible), then exactly one terminal
status. If the iframe navigates or remounts before completion the host cancels the request.

### `crew-host-event` — host → app invalidation

```ts
{ source: 'crew-host-event', version: 1, roomKey,
  type: 'approval-resolved' | string, approvalId?: number, data?: object }
```

Sent when a bound approval is submitted in the room, and used as the general refresh signal.
The bridge forwards it to blueprint code as a DOM event:

```ts
window.addEventListener('oddjob:crew-host-event', (e) => {
  // e.detail is the crew-host-event payload — invalidate queries / refetch records
});
```

## 4. Server-verified mounted-app grounding

When the user asks the room about the mounted app, `AgentChatPanel` sends a **hint** —
`{ path, selectedRecord? }` — and `resolveMountedAppContext`
(`server/domain/crew/core/crew-mounted-app-context.service.ts`) resolves it server-side:

1. `mountedAppSchema` accepts `/app/<slug>(/<segment>)*` paths with optional query/hash.
2. `resolveAppForRecords` matches `appDeployments.publicSlug` — under the caller's
   organization, Project Space, and private-room visibility — never the reported path alone.
3. A reported `selectedRecord` is verified with `readAppRecordById` before it enters
   context; an unverifiable selection is dropped silently.
4. The injected binding lists the app's collections with counts, marks the browser path as
   a *view hint, not evidence*, and reminds the agent that app telemetry is not an
   execution receipt.

The browser view is a hint, never proof — blueprint authors cannot smuggle record data or
permissions into agent context through `crew-app-view` payloads.

## 5. Execution receipts — `requireLaunchedMission`

`/api/platform/app/missions/trigger` can legitimately answer "no run exists": missing or
inactive missions return queued/outbox responses with `runId: null`, and unknown execution
outcomes are marked for reconciliation rather than retried. Every blueprint
`lib/platform-client.ts` that calls `/missions/trigger` must enforce:

```ts
export function requireLaunchedMission(receipt: MissionTriggerResult | null | undefined): number {
  if (!receipt || typeof receipt.runId !== 'number' || !Number.isInteger(receipt.runId)
      || receipt.runId < 1 || receipt.status === 'queued' || receipt.queued) {
    throw new Error(receipt?.message || 'Mission did not launch an active execution run');
  }
  return receipt.runId;
}
```

A queued receipt is not a launched run: the UI must surface the queued/blocked state, not
claim the mission started. The contract test fails on any platform-client that triggers
missions without this check.

## 6. Immutable decision collections

`IMMUTABLE_DECISION_COLLECTIONS` in
`server/domain/apps/platform/datasets.controller.ts` blocks `PUT` and `DELETE` on:

`qa_workbench_quality_gates`, `stakeholder_workbench_uat_signoffs`,
`stakeholder_workbench_cab_approvals`, `training_signoffs`, `deployment_log`

Saved gates, sign-offs and approvals are audit records: corrections are appended as a new
decision bound to the same revision, never an in-place edit. Extend the list — with the
same append-only rationale — when a new blueprint introduces a decision collection.

## 7. Surface adapter contracts — `surfaceAdapters`

`shared/crew-surface-connections.ts` decides which external integrations a mounted route
depends on (drives `CrewSurfaceConnections` readiness display). Resolution order:

1. `manifest.workbench_modules[].integration_dependencies` for the matching route id.
2. Top-level `manifest.integration_dependencies` from the cycle YAML app entry.
3. The `STANDALONE_BLUEPRINT_ADAPTERS` / route-contract tables in the file.
4. `null` — the contract test fails if a cycle-referenced blueprint resolves to `null`.
   Returning `[]` is the correct way to say "no external dependencies".

Prefer declaring `integration_dependencies` in the app entry of the cycle YAML over
editing the tables — the manifest is the durable source and the tables are the fallback.

## 8. The `/api/oddjob/[...path]` proxy

Every blueprint with a `lib/platform-client.ts` must expose a proxy route that forwards
`/api/oddjob/*` to the platform with the app's token:

- Pages Router: `pages/api/oddjob/[...path].ts`
- App Router: `app/api/oddjob/[...path]/route.ts`

Without it, client calls fail only in deployment — standalone dev servers often hide the
gap because they proxy differently. The contract test verifies the route exists for every
platform-client blueprint.

## 9. Checklist for a new blueprint

- [ ] `lib/platform-client.ts` calls `/api/oddjob/*` through a proxy route that exists (§8).
- [ ] Every `/missions/trigger` call is wrapped by `requireLaunchedMission` (§5).
- [ ] Decision/gate collections are append-only; add them to
      `IMMUTABLE_DECISION_COLLECTIONS` if they hold saved approvals (§6).
- [ ] Record-selection UI calls `window.oddjobCrew?.setSelectedRecord` so the room can
      ground on the open record (§2).
- [ ] Human input inside the app goes through `crew-surface-request` with a bound
      `app_record_action` approval — never a self-rendered modal that bypasses the room (§3).
- [ ] The cycle YAML app entry declares `datasets`, `dependent_missions`, and
      `integration_dependencies` matching the code (§7).
- [ ] `npx vitest run server/domain/apps/platform/blueprint-crew-contract.test.ts` is green.

---

## Implementation evidence

- `server/middleware/crew-app-activity-bridge.ts` — injected navigation/selection/activity bridge
- `shared/crew-surface-request.ts` — surface request schema + answer validation
- `server/domain/crew/core/crew-surface-approval.ts` — bound surface approval check
- `server/domain/crew/core/crew-mounted-app-context.service.ts` — server-verified mounted-app context
- `server/domain/apps/core/app-records-reader.service.ts` — `resolveAppForRecords`, `readAppRecordById`
- `client/src/components/agent-chat/CrewCycleAppCanvas.tsx` — iframe host, `getEmbeddedUrl`, message validation
- `client/src/components/agent-chat/BlueprintStudioLauncher.tsx` — App Studio entry point
- `shared/crew-surface-connections.ts` — `surfaceAdapters` contract resolution
- `server/domain/apps/platform/datasets.controller.ts` — `IMMUTABLE_DECISION_COLLECTIONS`
- `server/domain/apps/platform/missions.controller.ts` — durable mission receipts
- `server/domain/apps/platform/blueprint-crew-contract.test.ts` — the hermetic gate
