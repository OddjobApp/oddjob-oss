# Oddjob CREW for Android

A native Kotlin + Jetpack Compose client for CREW rooms. Like `desktop/`, it bundles
no server: it talks to a running Oddjob origin over the existing `/api/crew` routes.
No server changes were needed.

```bash
cd android
./gradlew :app:testDebugUnitTest      # JVM unit tests
./gradlew :app:assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Needs JDK 17+ (Android Studio's bundled `jbr` works; set `JAVA_HOME`) and an Android
SDK with platform 36. Add `local.properties` with `sdk.dir=...` or set `ANDROID_HOME`.
Kept outside the npm workspaces, so the root `npm install` and `npm run verify` never
touch Gradle.

Design, sync protocol, form parity, push and verification are documented in
[`docs/architecture/CREW_ANDROID_CLIENT.md`](../docs/architecture/CREW_ANDROID_CLIENT.md).

## What it does

- **Sign in** with `POST /api/login`. The `oddjob.sid` session cookie (30-day maxAge)
  is persisted, so a restart resumes the session. CREW routes take the speaker from
  `req.session.userId`, so an org API key would label every turn "Guest", which is why
  the app uses the session rather than `x-api-key`.
- **Rooms list** (`GET /api/crew/rooms?scope=all`): rooms from every organization
  you belong to, each labelled with its organization when they span more than one,
  and opened pinned to that org. Plus new room (`crew-<ms>-<7 chars>`, the
  same key format as the web) and join by key or shared `/workspace/chat/<key>` link.
- **Room**: transcript with Markdown, the live stream (`GET /:key/stream` over SSE,
  with reconnect and backoff and a delta re-sync on reconnect), send, stop round, room
  mode, crew roster, decisions/claims/commitments with status changes, and conclude
  and reopen.
- **Ground truth on each turn**: `toolsUsed` chips (✓/✗) and the model that actually
  served the turn, flagged in red when `wasFallback`.
- **Native chat forms** (`assistant_form`): a Kotlin port of the web's strict form
  engine (`shared/form-expression.ts` + `evaluateStudio`). Submitting sends the exact
  chat message the web sends. `FormParityTest` checks parity against fixtures produced
  by the TypeScript itself; regenerate `src/test/resources/form-parity.json` when the
  engine changes, from the repo root:
  `npx tsx android/tools/gen-form-parity.ts > android/app/src/test/resources/form-parity.json`.
- **Native turn cards** for what the crew now returns:
  - Google Workspace / Microsoft 365 / YouTube / Amazon / FlightHub / Granola results
    (`google_workspace_results`): tap items to make them chat context, then Discuss,
    Draft reply or Summarize prefill the composer, as on the web. The next message
    sends them as `selectedContext` refs. "Open in…" links open only each service's
    own hosts, and Load more asks for the next page.
  - Approvals for Google Workspace, Calendar, Amazon cart and FlightHub handoffs (args as
    labelled fields; checkout links only to that retailer), and outbound email/Slack
    messages with **Edit draft** before sending. The card re-reads the stored row
    (`GET /api/approvals/:id`), so a decision made elsewhere is not shown as pending.
  - Pipeline runs a crew proposes (org admins approve; the card shows started, finished
    or failed) and changes to an installed app's records (create, update or delete in one
    collection, applied only on approval). An approved calendar event shows its time in
    your zone, opens in Google Calendar, and **Verify in Google** re-reads it.
  - Refused calls the person can act on (`permission_required`): the steps to access,
    which are done, and who can take the rest. Private Granola searches: only the person
    who asked lists their matches and can **Share** one into the room.
  - Performance scorecards and phase-gate reviews, decision/claim/commitment cards
    (status changes patch by room key, with server-valid statuses only), governance
    checkpoints (read-only), Gmail sender alerts (`/directive` commands), work-product
    notices and carousels. Decision-matrix and forensic-timeline rails stay on desktop.
  - QuickBooks reports, verified calculations, forecasts and financial snapshots
    (save and compare), QuickBooks approval proposals, agent and app input requests (an
    answer the server did not record is not posted to the room), and generated images.
  - Guidance and imported-skill receipts, calendar operations exported as skill
    drafts (share SKILL.md, validate, submit, approve), calendar-outcome recovery,
    and a **Capabilities** sheet (room menu) with the room's tools and preflight checks.
  - Model-provider failures as an action card, bare URLs and `<a href>` links in
    agent prose, chips for items a message carried, and a copy button per turn.
- **Brief & work product** (room menu): the room objective, success criteria and scope
  (`PATCH /:key/brief`), and the deliverable's versions: view, copy, edit as a new
  version (`POST /:key/work-product`) or ask the crew to revise.
- **Expired connections**: a banner over the room lists connections whose authorization
  can no longer be renewed (`GET /api/me/connections/reauthorizations`); Reauthorize
  opens the consent flow on the Oddjob site in the browser.
- **Gmail alert pushes** (`/workspace/chat/<key>?gmailAlert=<id>`) open the room, post
  the triggering email (`POST /:key/notification-context`) and select it as context.
- **Agent selection**: the squad sheet has a checkbox per agent; only selected agents
  answer your messages. The choice is saved per person per room
  (`PUT /:key/active-agents`, shared with the web) and sent with every message as
  `agentCardIds`. "Add agents" picks from the org's agents.
- **Agent Pills**: the room's agents as a squad bar (tap to open the sheet), the `@`
  picker in the composer, and `@Name` pills in the transcript. Studio agents (tools
  `mount_*_studio` / `scribe_*`) are left out; studios are not part of the mobile app.
- **Maps** (`assistant_map`): Mapbox map preview with markers, routes and numbered
  stops; tap for a full-screen map. Places also open in the phone's maps app.
- **Your location**: Settings → Location → "Use my location on maps" (on by default,
  asks once). Maps with nothing to plot centre on you; your position stays on the phone.
- **Location beacon**: room menu → "Share my location". One fix, confirmed before
  sending, posted to the room as a map (`POST /:key/beacon`); everyone in the room's
  project gets a push and the agents see it on their next reply. Nothing is tracked.
- **Attachments**: the 📎 button takes a photo, picks photos or picks documents and
  uploads them to the room (`POST /:key/attachments`, 5 files of 25 MB at most). Each
  upload appears in the chat: photos as server-made thumbnails, documents as cards
  with a text preview. The bar above the composer shows each file and whether the
  server could read it; ✕ removes a file from the room so its agents stop searching it
  (`DELETE /:key/attachments/:id`). No
  storage or camera permission is requested (system pickers; the camera writes through
  a `FileProvider` into the app cache).
- **Offline rooms**: the 30 most recently opened rooms (last 200 turns each) and the
  rooms list are saved in the app's private cache, tied to server and account, and
  wiped on sign-out. A room opens from its saved copy, then refreshes. An unreachable
  server at launch keeps you signed in on the saved rooms.
- **Settings**: profile (name, Slack handle), quiet hours (stored on the server via
  `PATCH /api/users/me`, applied to alert suppression), tool/model detail toggle,
  push status, sign out.
- **Push (FCM)**: registers the install with `POST /api/push/devices` after sign-in and
  removes it on sign-out; approvals, finished missions, Gmail directive alerts and
  location beacons arrive as notifications; tapping a `/workspace/chat/<key>`
  notification opens that room. Needs Firebase, below.
- **Look**: always dark, using the site's `.dark` tokens, Inter + Space Grotesk
  (OFL, bundled in `res/font`), and the bowler-hat brand mark.

## Turning on maps

The build takes the Mapbox **public** token (`pk.…`) from the `MAPBOX_ACCESS_TOKEN`
Gradle property or environment variable, `mapbox.token=` in `local.properties`, or the
repo's `.env` (`MAPBOX_ACCESS_TOKEN`, the token the web already uses). A secret `sk.`
token is refused. Without a token the app builds and map cards list their places.

## Turning on push

1. In the Firebase console, create a project and add an Android app with package
   `app.oddjob.crew`. Download `google-services.json` into `android/app/` (gitignored).
   The Gradle build applies the google-services plugin only when that file exists.
2. Give the server a way to send. **No key needed** (the right choice where the
   organization blocks service-account keys): set `FIREBASE_PROJECT_ID=<project id>`
   and the server uses Application Default Credentials:
   - **Development:** `gcloud auth application-default login --scopes=https://www.googleapis.com/auth/firebase.messaging,https://www.googleapis.com/auth/cloud-platform`,
     then `gcloud auth application-default set-quota-project <project id>`. On Windows,
     if gcloud says "Python was not found", set `CLOUDSDK_PYTHON` to the SDK's
     `platform\bundledpython\python.exe`.
   - **Google Cloud:** grant the server's service account
     `roles/firebasecloudmessaging.admin`.

   Where keys are allowed, `FIREBASE_SERVICE_ACCOUNT_FILE=/path/to/key.json` (or
   `FIREBASE_SERVICE_ACCOUNT_JSON`) works too and takes precedence. Restart the server;
   boot logs a degradation while none is set.
3. Apply migration `0135_push_devices` (`npm run db:migrate`).

Settings → Notifications says which of these is missing.

## Mirrors of server/web behaviour

These must move together with their counterparts:

| Android | Mirrors |
|---|---|
| `RoomState.apply` (delta merge, forward-only cursor) | `applyRoom` in `client/src/components/agent-chat/useCrewSession.ts` |
| `StreamFrames.interpret` | that hook's SSE `onMessage` switch |
| `Models.kt` | `shared/schema/crew.ts`, `RoomSummary` in `crew-participants.service.ts` |
| `CrewEnums` | `crewRoomModes` / `crew*Statuses` in `shared/schema/crew.ts` |
| `WorkspaceResults.kt` (`Workspace`, `CrewText`, `Links`) | `shared/crew-workspace-results.ts`, `crew-provider-error.ts`, `amazon-links.ts`, `flighthub-links.ts`; `WorkspaceResultCard.tsx` |
| `ApprovalArgs` and the action/outbound branches of `Approvals` | `shared/approval-args.ts`, `InlineApprovalCard.tsx` |
| `CrewAccess.kt` | `shared/crew-permission.ts`, `oauth-reauthorization.ts`; `GranolaPrivateResultsCard.tsx` |
| `CalendarConfirmation` | the confirmation in `approvals/CalendarApprovalView.tsx` |
| `CrewArtifacts.kt` | `shared/crew-review.ts`, `crew-work-product.ts`, `crew-room-brief.ts`, `CrewDurableStateCards.tsx` |
| `Markdown.linkify` | `client/src/components/agent-chat/turn-linkify.ts` |
| `AgentSelection` | `selectedIds` / `toggleAgent` in `AgentChatPanel.tsx`; `saveActiveAgentSelection` |
| `MapCardData` | `MapSurface.tsx` (markers, route, style, zoom) |
| `WorkspaceIcons` | `GoogleWorkspaceIcon.tsx` |

The JSON decoder ignores unknown keys, so new server columns do not break an
installed app. Renamed or removed fields will.

## Not done yet

- **Other rich turn surfaces** (decks, tables, lists, diagrams, instant-app blocks,
  decision-matrix and forensic-timeline rails) show a one-line note.
- **Live location sharing**: beacons are one-time by design; `location`/`geo` form
  fields still take a typed address.
- **In-room message notifications**: the stream is held only while a room is on
  screen; CREW messages themselves do not push.
- Breakouts, scheduling polls, and an org switcher (a room's own
  org is honoured via `x-organization-id` once it has loaded).
- **Release signing**: `assembleRelease` produces an unsigned APK.
- **Cleartext HTTP is debug-only** (`src/debug/res/xml/network_security_config.xml`),
  so a release build needs an `https://` origin.
