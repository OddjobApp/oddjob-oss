# CREW Android client

_Status: experimental (product capability `crew-mobile`). Added 3 Oct 2026; brought up
to date with the CREW room on 8 Oct 2026 (workspace results, new approval kinds,
reviews, maps, agent selection, location beacons, offline rooms, phone push live).
Lives in `android/`; build and setup steps are in `android/README.md`._

A native Kotlin + Jetpack Compose client for CREW rooms. It is a **client of the
existing CREW API**, the same `/api/crew` routes and session the web room uses. It
embeds no WebView and renders nothing from the web bundle. Like `desktop/`, it
bundles no server and sits outside the npm workspaces, so `npm install` and
`npm run verify` never touch Gradle.

Scope was set deliberately narrow: **CREW chat only, rendered natively, no studios.**
Studio mounts (Scribe, Media, Form, App, Agent, Signal, Prediction) and the
decision-matrix and forensic-timeline rails show as a one-line note. Rich turn
surfaces that are not native yet show a "not shown on mobile yet" line rather than
disappearing.

## Contents

1. [Architecture](#architecture)
2. [Identity and session](#identity-and-session)
3. [Room synchronisation](#room-synchronisation)
4. [Turn rendering](#turn-rendering)
5. [Chat forms and parity with the web engine](#chat-forms-and-parity-with-the-web-engine)
6. [Agent Pills and the squad bar](#agent-pills-and-the-squad-bar)
7. [Settings and the self-service profile route](#settings-and-the-self-service-profile-route)
8. [Push notifications](#push-notifications)
9. [Approvals](#approvals)
10. [Maps, location and beacons](#maps-location-and-beacons)
11. [Attachments](#attachments-documents-photos-and-the-camera)
12. [Offline rooms](#offline-rooms)
13. [Look and branding](#look-and-branding)
14. [Verification](#verification)
15. [Not done](#not-done)
13. [Mirrors that must move together](#mirrors-that-must-move-together)

## Architecture

```
android/app/src/main/java/app/oddjob/crew/
├── CrewApplication.kt      one OddjobApi + cookie jar per process; push scope; deep-link queue
├── MainActivity.kt         navigation: login → rooms → room | settings; notification taps
├── data/                   wire models, API client, cookie jar, room state + stream reducer, room cache,
│                           pills and agent selection, workspace results, approvals, review/record/map parsers
├── forms/                  Kotlin port of the web form engine (expression evaluator, evaluateStudio)
├── push/                   FCM registration, notification channel, messaging service
└── ui/                     Compose screens: login, rooms, room (+ sheets, turns), cards, pills, settings, theme
```

| Concern | Choice | Why |
|---|---|---|
| UI | Jetpack Compose, Material 3 | Native; themable to the site's tokens |
| HTTP | OkHttp + `okhttp-sse` | Cookie jar, timeouts per call type, SSE |
| JSON | kotlinx.serialization, `ignoreUnknownKeys` | A server that adds a column does not break an installed app |
| State | `ViewModel` + `StateFlow` | Survives rotation; one source of truth per screen |
| Images | Coil 3 | Thumbnails, from the web's allowlisted image hosts only |
| Maps | Mapbox Maps SDK 11.32 + Compose extension | Public Maven repository; public `pk.` token only |
| Build | AGP 8.13.2, Kotlin 2.2.21, Gradle 8.14.3, minSdk 26, target 36 | |

Pure logic (room-state merge, stream reducer, Markdown parser and link detection,
form engine, pills matching, agent selection, workspace results, approval fields,
review scoring, map payloads, room cache) has no Android types, so it is unit-tested
on the JVM.

## Identity and session

The app signs in with `POST /api/login` and keeps the `oddjob.sid` cookie in a
persistent cookie jar in app-private storage (`allowBackup=false`, backup and
device-transfer exclusions on the prefs). Mutating requests carry `x-csrf-token`
from `GET /api/user`.

**It uses the person's session, never an org API key.** CREW routes take the
speaker from `req.session.userId`; an API key would post every turn as "Guest".

**Idle expiry is respected, not worked around.** The server clears authentication
after an idle window (`middleware/session-idle-timeout.ts`). The app does not store
passwords to re-authenticate silently, which would defeat that control. On the next
launch it shows "Your session timed out" with the username prefilled.

**Unreachable is not signed out.** At launch the app asks `GET /api/user` whether
the session is still good. Only an answer from the server ends it; a network failure
opens the app on its saved rooms (see [Offline rooms](#offline-rooms)), and the first
real answer decides.

**A 401 is confirmed before sign-out.** A single denied route inside a room does not
end the session. The app asks `GET /api/user` whether the session is still
authenticated, and only then returns to login (`OddjobApi.sessionIsValid`). Every
failed request logs method, path and status, never headers, cookies or bodies.

A room can live in another org than the session's default. Once a room has loaded,
its requests carry `x-organization-id` for that room's org, as the web client does.

## Room synchronisation

Mirrors `client/src/components/agent-chat/useCrewSession.ts`:

| Step | Request | Behaviour |
|---|---|---|
| List | `GET /api/crew/rooms?scope=all` | Rooms you are in across every org you belong to (`user_orgs`, plus the current org context), newest first, each with `organizationId` and `organizationName`. A participant row left in an org you have left lists nothing. The row's org travels with the navigation, so the room's first read is pinned to it |
| Open | `GET /api/crew/:key` | Full state. A room not created yet answers the empty shape, not 404 |
| Live | `GET /api/crew/:key/stream` (SSE) | Held only while the room is on screen; reconnects with backoff (1 s → 30 s) |
| Catch-up | `GET /api/crew/:key?since=<cursor>` | Delta merged by id; the cursor only moves forward |
| Send | `POST /api/crew/message` | Creates the room on first use; read timeout 10 min (it answers when the round ends). Carries `agentCardIds` (the person's selection) and `selectedContext` |

Stream frames are interpreted by `StreamFrames.interpret`, the same dispatch as the
web hook:

- `turn-content` carries the turn and is appended directly.
- An agent `turn` frame is ignored, because its content frame carries it.
- A user or supervisor `turn` triggers a delta fetch.
- `round-complete` and `round-cancelled` end the running-round indicator.

Fetches are coalesced through a conflated channel, so a burst of frames costs one
delta request. A reopened stream reconciles, because it may have missed frames.

**Who answers: agent selection.** As on the web, each person chooses which agents
answer them in a room (`data/AgentSelection.kt`, mirroring `AgentChatPanel`'s
`selectedIds`). The squad sheet has a checkbox per agent and "Add agents" opens the
org's agent list. The selection is:

- applied at once and saved per person per room with `PUT /:key/active-agents`
  (stored in `crew_sessions.memory.activeAgentSelections[userId]`), so the web and the
  phone open the room with the same choice;
- sent with every message as `agentCardIds`, which seats exactly those agents for the
  round;
- resolved as: a choice made on this phone, else the saved one (dropping agents the
  org no longer offers), else the room's roster. An empty saved choice is kept, and the
  sheet warns that the crew will then recruit specialists.

A crew chosen before the room exists rides on the first message the same way,
because `PUT /:key/members` cannot create a room. With none chosen, the server seats
three enabled agents.

**Selected context.** Tapping items in a results card selects them; the next typed
message sends their references as `selectedContext` (`turnId`, `tool`, `itemId`) and
the server re-reads them, as the web does. A bar above the composer lists them; they
are cleared once that message is sent. A user turn that carried items shows them as
chips; the JSON block the agents read stays hidden (`CrewText.splitWorkspaceContext`).
The pending-message echo compares only the typed part.

## Turn rendering

- Agent turns render a Markdown subset (headings, lists, fenced code, quotes, bold,
  italic, inline code, links). Raw `<a href>` links and bare URLs such as
  `youtube.com/watch?v=…` are linked (`Markdown.linkify`, the web's `turn-linkify.ts`
  rules: a bare domain needs a path, so `vitest.config.ts` stays text). Unrecognised
  syntax stays literal text.
- A supervisor turn that is a model-provider failure (no credit, quota, credentials,
  unreachable) shows as an "Action needed" card with the next step, not raw error text
  (`CrewText.providerError`, the web's `crew-provider-error.ts`).
- Every agent turn has a copy button: its text plus what its cards show.
- Under each agent turn the app shows the ground truth from `crew_turns`:
  `toolsUsed` as ✓/✗ chips, and the model that served the turn. A `wasFallback`
  turn is labelled "fallback model" in red. That label is shown even when the
  details toggle is off, so a degraded answer never passes as the requested model's.
- Turn artifacts are classified by `TurnCards.classify`:

| Artifact | On the phone |
|---|---|
| `assistant_form` | Native form card |
| `approval_request` | Native approval card (see below) |
| `google_workspace_results` (Gmail, Calendar, Drive, Microsoft 365, YouTube, Amazon, FlightHub) | Results card: brand icon, per-kind fields, YouTube and Amazon thumbnails, Summarize / Discuss / Draft reply / Open in…, Select all, Load more. Emails load collapsed; dates show in the event's zone |
| `performance_scorecard`, `gate_review` | Review card: score only when every dimension is assessed, gates, actions, evidence |
| Decision, claim, commitment proposals | Record card with status buttons (server-valid statuses only, patched by room key) |
| Governance checkpoint | Read-only: the web card's buttons record nothing, so the phone offers none |
| `gmail_directive`, `gmail_directive_list` | Sender-alert card with Pause / Resume / Status / Remove (`/directive` commands) |
| `crew_work_product` | Notice that opens the Brief & work product sheet |
| `assistant_carousel` | Horizontal carousel |
| QuickBooks results (`platform: "quickbooks"`) | Reports (headline totals, then the table), verified calculations, forecasts with scenarios, snapshots with **Save snapshot**, and snapshot comparisons (`data/Financial.kt`, `ui/cards/FinancialCards.kt`). Money is formatted exactly as `shared/crew-money.ts` does |
| `room_attachments` | The files someone uploaded: photo thumbnails (server-made WebP) and document cards |
| `input_request` | The native form; submitting resolves the request (`POST /api/oddjob/forms/:id/submit`) and posts the web's "… form with:" line |
| `assistant_image` | The generated image, from a same-origin path or https only |
| `crew_guidance_receipt` | "Guidance loaded · N procedures", collapsed: each procedure, why it loaded, its version and hash. Loaded into the prompt is not execution |
| `crew_imported_skill_receipt` | "Imported skills", collapsed: each reviewed contract's status, missing tools and the tool calls behind it. Hidden when a checked selection found none |
| `crew_operation_skill_draft` | The draft, its SKILL.md (exactly `operationSkillMarkdown`), **Share SKILL.md** / **Share contract**, and **Review and register skill**: validate (mock inputs, no provider writes), submit and approve; the server requires organization management for the last two |
| `assistant_map`, `map` | Native map (see [Maps](#maps-location-and-beacons)) |
| Studio mounts, pods, rails, `assistant_app`, `mount_*` tools | "… · opens in Oddjob on desktop" |
| Everything else (decks, tables, lists, diagrams, instant-app blocks) | "… · not shown on mobile yet" |

Artifacts are de-duplicated with the web's rule: the first of artifacts sharing a
tool and a module, title, chart or type. Result lists are never de-duplicated.

**Links and images are allowlisted.** "Open in…" links open only each service's own
hosts (`Workspace.openLink`), retailer links must be plain https on Amazon or
FlightHub (`Links`), and thumbnails load only from YouTube's and Amazon's image hosts
(`Links.thumbnail`), all mirroring the web card, so a tool result cannot point the
phone anywhere else. Brand marks are the web's inline SVGs (`GoogleWorkspaceIcon.tsx`)
redrawn as vectors in `ui/theme/WorkspaceIcons.kt`.

**Brief & work product** (room menu): the room's objective, success criteria and
scope (`PATCH /:key/brief`), and every version of its deliverable, to read, copy,
edit as a new version (`POST /:key/work-product`) or ask the crew to revise.

**Capabilities** (room menu): the web's readiness panel (`GET /:key/readiness`,
`studio=none`): preflight checks, recipes and which agents lack their tools,
project resources, integrations, applied skills and each agent's offered tools.
A tool being offered is not proof it will run; execution still checks permissions
and inputs.

## Chat forms and parity with the web engine

In the web room, every card action is a chat message: `TurnRow` is given
`onArtifactSubmit={send}`. Approvals are the exception and post
`/api/approvals/:id/decision` first. The app follows the same contract. A submitted
form sends exactly the text the web sends:

```
I submitted the "<title>" with: <JSON of {...inputs, ...values}>
```

The crew therefore reacts the same way whichever device submitted.

`forms/` is a port of the **strict** path the web's `StudioForm` runs:

| TypeScript | Kotlin |
|---|---|
| `shared/form-expression.ts` (`tryEvaluateExpression`) | `FormExpression.evaluate` |
| `shared/form-studio-legacy.ts` (`definitionFromLegacyForm`) | `FormSpecs.parse` |
| `shared/form-studio.ts` (`evaluateStudio`, `orderedComputedFields`) | `FormSpecs.evaluate`, `FormSpecs.orderedComputed` |
| `ResultBlocks.tsx` (`formatValue`) | `FormFormat.value` |

The port keeps the JS value semantics the engine is defined in:

- `+` adds only when both sides look numeric.
- Truthiness follows JS, and `parseFloat` prefix parsing is reproduced.
- A missing input travels through a calculation as "missing", not as 0.
- Division by zero is an error in strict mode.

Two details needed care:

- `pow`, `log` and `atan2` use `StrictMath`, which like V8 is an fdlibm port. The
  JVM's `Math` intrinsics differed in the last digit on `fv(...)`.
- Numbers print as JavaScript's shortest round-trip digits, computed by the app
  itself rather than via `Double.toString`, whose digits are not guaranteed shortest
  on every Android release.

**Parity is tested against the TypeScript itself.** `android/tools/gen-form-parity.ts`
runs the real engine over 59 formulas and 4 forms and writes
`app/src/test/resources/form-parity.json`. `FormParityTest` asserts the Kotlin
outcome, error messages and exact submission text match. Regenerate the fixture
whenever the engine changes:

```bash
npx tsx android/tools/gen-form-parity.ts > android/app/src/test/resources/form-parity.json
```

A form whose submission message already appears in a later user turn shows as
submitted, on any device. Unsupported field types are explicit: `query` says it is
looked up on the server; `location`/`geo` take a typed address.

## Agent Pills and the squad bar

- **Squad bar**: one row under the room header. It shows up to four overlapping
  robot-head avatars in each agent's accent and "N Humans · M Agents". Tapping it
  opens a sheet listing the people and agents, and tapping an agent there mentions
  it. The web's two-row pill strip cost a phone a fifth of the screen.
- **`@` picker**: typing `@` plus at least three characters offers matching agents.
  It matches by name, archetype, persona or capability, puts name-prefix hits first,
  and shows at most eight (`CrewComposer.tsx` rules).
- **Transcript pills**: `@Name` for a room member is drawn as a tinted pill. It
  matches only on whole words, longest names first.
- **Studio agents are left out.** "Studio agent" is decided from capabilities, not
  names: tools `mount_*_studio` or `scribe_*`. `mount_builder_pod` is not a studio
  mount, so Copilot stays. The sheet notes how many studio agents were omitted.
- Accent colours use the web's `accentFor` hash, so an agent keeps its colour across
  web and phone.

## Settings and the self-service profile route

Settings contains only things that take effect:

- **Profile**: first and last name and Slack handle; username and email are read-only.
- **Quiet hours**: on/off, start, end and IANA timezone. These are stored on the
  user and applied by server-side alert suppression (`admin/core/quiet-hours.ts`).
- **Notifications**: push status in plain words, with the one action that can fix it
  from the phone.
- **App**: the tool/model details toggle, server, version, and sign-out with
  confirmation.

There was no route a user could update their own profile through. The web Profile
page had been PATCHing a URL that was never mounted. The new route:

- `PATCH /api/users/:id` (`server/routes/users.ts`), where `:id` must be the caller
  or `me`.
- Validated by `parseSelfProfileUpdate` (`server/domain/org/core/self-profile.service.ts`).
  It accepts exactly: `firstName`, `lastName`, `slackHandle`, `quietHoursEnabled`,
  `quietHoursStart`/`End` (24-hour `HH:MM`), and `quietHoursTimezone` (IANA). `email`
  is accepted only unchanged, because login resolves by email. Any other field
  returns 400 naming it.
- The app sends only fields that changed. See [SECURITY_BOUNDARIES.md §2](../SECURITY_BOUNDARIES.md#2-identity-boundary-authentication)
  for the related hardening.

## Push notifications

Phone push goes through **Firebase Cloud Messaging**. It joins browser web push
(VAPID, migration 0127) rather than replacing it.

```
approval sweep / mission completion
        │  pushService.sendOnce(source, id, user, payload)     (ledger: one push per thing per person)
        ▼
pushService.sendToUser ──► browsers: web-push to push_subscriptions        (if VAPID configured)
                       └─► phones:   fcmService.send to push_devices       (if Firebase configured)
                                     FCM HTTP v1, channel "approvals", data.url = same-origin path
```

| Piece | Where |
|---|---|
| Table `push_devices` (one row per install; unique token; failure count) | `shared/schema/push.ts`, migration `migrations/runtime/0135_push_devices.sql` |
| Sender (FCM v1 over `googleapis` auth; no `firebase-admin`) | `server/domain/core/notifications/fcm.service.ts` |
| Fan-out, dead-token removal (`UNREGISTERED`, invalid token, 5 failures) | `pushService.sendToDevices` |
| Routes | `POST`/`DELETE /api/push/devices`; `GET /api/push/config` reports `devices` |
| Config | `FIREBASE_PROJECT_ID` alone (keyless, Application Default Credentials), or a key: `FIREBASE_SERVICE_ACCOUNT_FILE` / `FIREBASE_SERVICE_ACCOUNT_JSON`; a boot degradation is logged while none is set |
| App | `push/Push.kt`: registers after sign-in and on token rotation, unregisters before sign-out, notification channel, messaging service |

Tapping a notification for `/workspace/chat/<key>` opens that room in the app.
Any other path opens on the web.

The app is built so that push is optional. The google-services Gradle plugin applies
only when `android/app/google-services.json` exists, and without Firebase every push
step is a no-op. Settings then says "Not in this build" or "Not set up on the
server", so push never appears on when it is not. Setup steps are in
`android/README.md` ("Turning on push").

**No service-account key needed.** Organizations whose policy forbids key creation
(`iam.disableServiceAccountKeyCreation`) set only `FIREBASE_PROJECT_ID`; the FCM token
then comes from Application Default Credentials: the runtime identity on Google
Cloud (grant it `roles/firebasecloudmessaging.admin`), or
`gcloud auth application-default login` plus
`gcloud auth application-default set-quota-project <project>` in development.
Verified end to end on 8 Oct 2026 (project `oddjob-f75c7`).

**Triggers today:** approvals waiting on a person, computer-use tasks that stopped
for their owner, missions they started finishing, **Gmail directive alerts**
(important senders), and **location beacons** raised in a room of a project they belong to. CREW
messages do not push.

Gmail directive alerts are sent to anyone push can reach, browser **or** phone
(`pushService.canReach`). They used to require a browser subscription, so a person
with only the app was never alerted. A directive alert opens its room with
`?gmailAlert=<event>`; the app then posts the triggering email
(`POST /:key/notification-context`) and selects it as context.

**Where a tap lands.** A notification carries a same-origin path. The app opens it
natively when it can, from any signed-in screen (a tap before sign-in waits for it):

| Path | Opens |
|---|---|
| `/workspace/chat/<key>` | That room |
| `/workspace/chat/<key>?gmailAlert=<event>` | That room, with the alert's email loaded and selected |
| `/assistant/workbench?approval=<id>` | The approvals inbox, that approval first |
| `/workspace/computer-use?task=<id>&orgId=<org>` | The paused task: what the agent needs, a reply field, Continue / Stop |
| anything else | The browser, at the server URL |

## Approvals

`data/Approvals.kt` turns both sources into one view: an `approval_request` card in a
turn, and a row from `GET /api/approvals` (whose proposal envelope is on
`modifiedOutput` or `toolArgs`). Classification follows the web's
`InlineApprovalCard`:

- An outbound message reads as the message: "New email" or "Slack message",
  recipients, subject and the body exactly as it would be sent, with **Edit draft**
  (body and subject only; recipients stay as proposed) and Send / Discard.
- Google Workspace and Calendar changes show their arguments as labelled fields
  (`data/ApprovalArgs.kt`, the web's `shared/approval-args.ts`), never the routing
  envelope.
- Amazon cart and FlightHub booking handoffs say that approving prepares a link and
  nothing is bought, and link only to that retailer's checkout.
- QuickBooks proposals (`quickbooks_action`: invoice, customer, payment, void) show
  the company and customer, the amounts in the proposal's currency, and what
  approving does and does not do (an invoice is not emailed; a void cannot be undone).
- Calendar proposals from a verified email show the "Verified email → calendar ·
  timezone · N source message(s)" line. An approved event create whose outcome is
  `executing` or `outcome_unknown` offers **Check calendar outcome**, which re-asks
  the server; it reconciles the existing event and never writes a second one. One
  that verifiably succeeded offers **Export as skill draft**
  (`POST /:sessionKey/operation-skill-drafts`), unless the turn already holds the draft.
  A calendar decision posts no room message: the card shows the stored outcome, and
  a message would reattach the selected email and start scheduling again.
- A verification code (`2fa`, `mfa`, `two_factor_auth`, `verification_code`) is typed
  in and sent as `modifiedOutput.solution`.
- A CAPTCHA (an image to click) and a Form Studio stage are decided on the web; the
  card says why rather than offering a button that cannot work.
- A proposal whose id is a timestamp was never saved and cannot be decided.

Deciding posts `/api/approvals/:id/decision`. The route answers 200 also when the
request was resolved earlier, so the card reads the body and says "Someone decided
this before you" instead of claiming the decision. In a room, a recorded decision
then posts the web card's line word for word ("I approved proposal #42 ("…").",
"I sent the email message to …", "Calendar change applied: …"), and a card whose
decision line is already in the room shows as decided.

For outbound messages and tool proposals the turn's card is only a snapshot, so the
card re-reads the stored row (`GET /api/approvals/:id`): a decision made in the inbox
or on the web is not shown as pending, and a failed send says so.
Approval rows are org-scoped, so the re-read and the decision carry the room's org
(`x-organization-id`); without it a room outside your default org reads as 404 and
its card stays pending.

## Maps, location and beacons

**Maps.** `assistant_map` cards render with the Mapbox Maps SDK
(`ui/cards/MapCard.kt`): markers, a route (solid when routed, dashed-looking when only
straight lines between stops), numbered stops, and the payload's dark / satellite /
streets style. The card is a preview that does not take the transcript's scroll; a
tap opens a full-screen map to pan and zoom. Places are also listed with "Open in
Maps" (a `geo:` intent).

The SDK's Maven repository is public now, so no secret downloads token is needed.
The build reads a **public** `pk.` token from the `MAPBOX_ACCESS_TOKEN` Gradle property
or environment variable, `mapbox.token` in `local.properties`, or the repo's `.env`,
and refuses an `sk.` token, since anything in the APK is readable. Without a token
the app builds and lists places instead.

**Your location on maps.** Settings → Location → "Use my location on maps" (on by
default). The first map card shown asks for the location permission once; after that
every map shows the person's dot. A map with nothing to plot (for example "show me a
map of my location", which the server otherwise centres on Los Angeles) centres on
the person; a map of places keeps them in view and adds the dot. The position stays
on the phone.

**Location beacon.** Room menu → "Share my location": one fresh fix, a confirmation
that says exactly who will see it, then `POST /api/crew/:key/beacon`
(`server/domain/crew/core/crew-beacon.service.ts`). The server:

- posts a turn from the person with the coordinates in words (the agents' context on
  their next round; no round is started) and a map artifact (`location_beacon`),
  which both the web and the app draw;
- pushes "<name> shared their location" to everyone in the room's project (its user
  members and owner) and everyone taking part in the room, opening the room. A room
  outside a project notifies its participants (`beaconRecipients`).

It is one fix, sent only after the person taps Share. Nothing is tracked.

## Attachments: documents, photos and the camera

The 📎 button in the composer (`ui/room/Attachments.kt`) offers **Take photo**,
**Choose photos** and **Choose document**, and uploads to the room's existing route,
`POST /api/crew/:key/attachments` (multipart `files`, at most 5 files of 25 MB; the
phone checks both before sending). The server stores each file with the room's
project, reads it (photos through image recognition on the org's AI key) and indexes
it into the project's knowledge, so the agents draw on it as room context. As on the
web, uploading does not post a message.

- No storage or camera permission is asked for: the system photo picker and document
  picker grant access per file, and the camera app writes the photo into the app's
  cache through a `FileProvider` (`res/xml/camera_paths.xml`); old captures are
  deleted before the next one.
- Each upload is posted to the room as a turn from the person, so it appears in the
  chat: photos as thumbnails made on the server
  (`GET /:key/attachments/:id/thumbnail?w=`, a small WebP with metadata stripped,
  cached), documents as cards with the opening lines of their extracted text. A photo
  opens full screen; a document opens in the phone's app for its type. Images load
  through the app's signed-in HTTP client (a Coil image loader in `CrewApplication`).
- Document types match the web's `accept` list (PDF, Word, Excel, CSV, Markdown,
  text, JSON, XML, YAML, images).
- The bar above the composer lists the room's files (`GET /:key/attachments`) with
  size and state: "reading…", "ready", or "couldn't read (…)", as the web bar says.
- A room exists only after its first message, so the button is disabled until then.
  The upload uses the long timeout, because the server reads a file before answering.

## Offline rooms

`data/RoomCache.kt` saves recently opened rooms and the rooms list in the app's
private cache directory (never backed up):

- Each file records its server and account and is ignored for anyone else; signing
  out deletes them all.
- At most 30 rooms (least recently used evicted) and the last 200 turns each; the
  saved cursor matches the turns kept, so a delta never skips trimmed turns.
- Writes are atomic (temp file, then rename), debounced after each update, and run on
  the application scope so the last save lands after the room is left.

A room opens from its saved copy at once ("Saved copy · connecting" in the header),
then the usual full read replaces it.

## Look and branding

The app is always dark, with colour tokens taken from the `.dark` block of
`client/src/index.css` (shadcn slate):

| Token | Value |
|---|---|
| Background | `#020817` |
| Foreground and primary | `#F8FAFC` |
| Secondary, muted and border | `#1E293B` |

Inter and Space Grotesk are bundled under `res/font` (OFL), matching `--font-sans`
and `--font-heading`. The brand mark is the bowler hat
(`client/public/assets/branding/bowler-hat.png`): the login lockup copies `Login.tsx`,
and the hat is also the launcher icon and a silhouette status-bar glyph. The site's
favicon is a different mark (orange blocks); the app follows the hat.

## Verification

- **102 JVM unit tests:**
  - API client against MockWebServer: cookie persistence, CSRF, org header, path
    encoding, error shapes.
  - Room-state merge and stream reducer; room cache (account scoping, trimming,
    eviction, corrupt files, sign-out).
  - Markdown parser and link detection (the web's `turn-linkify` cases).
  - Form parity: 59 formulas and 4 forms from the TypeScript.
  - Workspace results, approval kinds and fields, reviews, record cards, maps,
    agent selection.
  - Pills, deep links (including `?gmailAlert=`).
- **Server tests** for the routes added with the app: the self-service and admin
  allow-lists, the `requireAuth` public-route matcher, the FCM message and error
  classification, and the capability manifests.
- **Real data:** every `google_workspace_results` and `gmail_directive` payload in
  the dev database parsed into its native card.
- **End to end on an emulator** against the dev server (8 Oct 2026 additions: results
  and email cards, YouTube thumbnails, maps with the person's location, agent
  select/deselect saved on the server, offline rooms in airplane mode, a phone push
  through keyless FCM, a Gmail directive alert opening its room):
  - Sign-in, and session resume after force-stop and reinstall.
  - A live round in a new room, with the turn attributed to the session user.
  - A real calculator form computing live.
  - The `@` picker, the squad bar and sheet, and the expired-session prompt.
  - Settings saved and confirmed on the server.
  - Sign-out.

## Not done

- **Native renderers for other cards:** decks, tables, lists, diagrams, instant-app
  blocks, and the decision-matrix and forensic-timeline rails.
- **Device location** for `location`/`geo` form fields (maps and beacons use it).
- **Live location sharing:** beacons are one-time by design.
- **Push in other environments:** each needs `FIREBASE_PROJECT_ID` and the FCM role
  (or a key where allowed), and migration 0135 (`npm run db:migrate`).
- **Release signing.** Cleartext HTTP is allowed in debug builds only.
- **Other room features:** breakouts, scheduling polls, and an org switcher.

## Mirrors that must move together

| Android | Counterpart |
|---|---|
| `RoomState.apply` | `applyRoom` in `useCrewSession.ts` |
| `StreamFrames.interpret` | that hook's SSE `onMessage` |
| `Models.kt` | `shared/schema/crew.ts`; `RoomSummary` in `crew-participants.service.ts` |
| `CrewEnums` | `crewRoomModes` / `crew*Statuses` in `shared/schema/crew.ts` |
| `forms/` | `shared/form-expression.ts`, `form-studio-legacy.ts`, `form-studio.ts`, `ResultBlocks.tsx` (`formatValue`) |
| `TurnCards.dedupe` | the artifact filter at the top of `TurnRow`'s artifact list |
| `AgentPills` | `CrewComposer.tsx` mention rules; `renderPillMentions` and `accentFor` |
| Submission text | `TurnRow`'s `onArtifactSubmit` for `assistant_form` |
| `data/Approvals.kt` (classification, decision line) | `InlineApprovalCard.tsx` (`isCaptcha`/`isOtpChallenge`, `handleDecision`'s `onArtifactSubmit` text) |
| Deep-link paths in `MainActivity.kt` | push URLs in `push-approval-sweep.ts`, `notifyPause` (`computer-use-task.service.ts`), `gmailAlertRoute` (`shared/gmail-notification-handoff.ts`) and `crew-beacon.service.ts` |
| `data/WorkspaceResults.kt` (`Workspace`, `CrewText`, `Links`) | `shared/crew-workspace-results.ts`, `crew-provider-error.ts`, `amazon-links.ts`, `flighthub-links.ts`; `WorkspaceResultCard.tsx` |
| `data/ApprovalArgs.kt`; action and outbound branches of `Approvals` | `shared/approval-args.ts`; `InlineApprovalCard.tsx` |
| `data/CrewArtifacts.kt` | `shared/crew-review.ts`, `crew-work-product.ts`, `crew-room-brief.ts`; `CrewDurableStateCards.tsx`; `MapSurface.tsx` |
| `data/AgentSelection.kt` | `selectedIds` and `toggleAgent` in `AgentChatPanel.tsx`; `saveActiveAgentSelection` |
| `Markdown.linkify` | `client/src/components/agent-chat/turn-linkify.ts` |
| `ui/theme/WorkspaceIcons.kt` | `GoogleWorkspaceIcon.tsx` |
| `CrewMoney`, `FinancialReports` and the financial parsers in `data/Financial.kt` | `shared/crew-money.ts`; `FinancialReportItemView.tsx`, `CalculationItemView.tsx`, `ForecastItemView.tsx`, `FinancialSnapshotItemView.tsx` |
| QuickBooks branch of `Approvals` | the `quickbooks_action` branch of `InlineApprovalCard.tsx` |
| `data/CrewSkills.kt`; `ui/cards/SkillCards.kt`; `ui/room/ReadinessSheet.kt` | `shared/crew-guidance-receipt.ts`, `crew-imported-skill-receipt.ts`, `crew-operation-skill.ts`, `crew-readiness.ts`; `CrewGuidanceReceiptView.tsx`, `CrewImportedSkillReceiptView.tsx`, `CrewOperationSkillDraftView.tsx`, `CrewOperationSkillReview.tsx`, `CrewReadinessPanel.tsx` |
