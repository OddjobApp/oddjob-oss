# Media Studio in CREW — Proposal

**Status:** draft, 2026-09-12. Phases are driven one at a time.

**Decisions already made (2026-09-12):**
- Scenes, shots and takes are **persisted** (org-scoped tables, a migration).
- **Assemble Master Reel stitches for real** with `ffmpeg-static`.
- **Every live render is approved** first. Simulation runs are labelled Simulation and need no approval.
- Deck mode becomes a **storyboard sequencer**: it renders **keyframes for scenes and plot points**, and those keyframes feed the shots.

**Decisions made 2026-09-13:**
- The **story lives in a linked Scribe screenplay**: a production links to a manuscript, each scene to the station that tells it, and characters and locations come from Scribe's entity ledger.
- **Dialogue is spoken by the video model**: structured lines (character, line, delivery) compiled into the Seedance prompt with audio on, which lip-syncs speech.
- **Seedance is served through fal.ai** (`FAL_KEY`), whose schema was verified: `image_url` first frame, `end_image_url`, `duration` 4–15 s, `resolution`, `aspect_ratio`, `generate_audio`. The `api.seedance.ai` endpoint in `seedance.ts` appears in no documentation, and its $0.04/s estimate is 7–12× low (fal: $0.30/s at 720p for 2.0).
- **Story, direction and dialogue fold into Phase 2.**
- Sora is not an option: OpenAI's Videos API shuts down on 2026-09-24.

---

## 1. Where it stands

### 1.1 What exists

**Committed** in `de14fcea8` (Sep 5):
- `seedance_estimate_cost`, `seedance_submit_shot` and `seedance_check_status` in `server/domain/tools/v1/capabilities/seedance.ts`.
- `assemble_scene_timeline` and `render_dailies_deck` in `video-assembly.ts`.

**Uncommitted WIP** (another writer, 22:05–22:13 on Sep 12):
- `client/src/modules/media/`: `MediaStudioPod`, `MediaStageCanvas`, `MediaDailiesInspector`, `MediaTimelineSequencer` and `types.ts`.
- `mount_media_studio` in `video-assembly.ts`.
- A Media Studio branch in `ModularAssemblyPuzzleRail`.
- A `media` value in `CrewRailKind`.
- A client-only `film_production_studio` topic archetype.

### 1.2 Why none of it works in a room

| Piece of the CREW surface contract | State |
|---|---|
| Tool offered to crew agents (`crew-tools.service.ts` ARTIFACT_TOOLS and the agent list) | missing |
| `media_studio_pod` in `RICH_PAYLOAD_TYPES` (otherwise the output is treated as text and never becomes an artifact) | missing |
| Rail branch | present, reached only by a unit test with a hand-built artifact |
| `StudioMountNotice` kind (otherwise the turn tries to render `MediaStudioPod` through the packaged registry, which does not contain it) | missing |
| `AgentChatPanel`: mount key, dismiss, `hasStudioActive`, visibility and close props | missing |
| Topic card | client-only; the server `DIVERSE_TOPIC_DEFINITIONS` replaces the list and has no film topic |

### 1.3 What it shows that is not true

Studio:
- A three-shot demo storyboard ("neon alleyway", "Elena") whenever no shots are passed. The mount tool never passes any.
- A hardcoded footer, "CPM Wave 2 in flight · Concurrency 2/3", with a spinning icon.
- Placeholder audio beds shown as if they were tracks.
- A budget the agent can set to anything.
- Approve, Re-roll and Assemble change only the screen. A re-rolled take stays "rendering" forever.
- Deck mode renames a button and nothing else.
- Playback is broken:
  - The scrubber uses timeline time while the video reports shot time.
  - Seeking never moves the video.
  - Switching shots does not keep playing.

Server:
- With no `SEEDANCE_API_KEY` (there is none in `.env`), `seedance_submit_shot` invents a `storage.oddjob.io` video URL. `seedance_check_status` marks the job completed with that URL after 5 seconds.
- Jobs live in an in-memory `Map`: lost on restart, not org-scoped.
- A live submit spends money with no approval.
- `assemble_scene_timeline` returns `status: "success"` with an invented reel URL. There is no ffmpeg dependency or binary anywhere.

### 1.4 What we can build on

- **Storage:** `storageService` saves to GCS in production and to local disk under `storage/org_data/<org>/` in development. No route serves stored files to the browser.
- **Approvals:** the workflow-node pattern (`workflow-nodes.service.ts`).
  - The request kind is stored in `modifiedOutput`.
  - `approvalService.processDecision` branches on that kind and reads only the stored copy.
  - `executionId` is `…:t<epoch>`, never ending in `:<digits>`.
- **Gemini:** `google-client.ts` calls the Gemini REST API (`generateContent`). No image model is wired; image generation today is DALL·E only.
- **Rooms:** `crew_sessions` has `organization_id` (not null) and a nullable `project_id`.
- **Decks:** `pptxgenjs` is already a dependency, for storyboard export.
- **Existing pattern:** Form Studio's CREW wiring (`crew-form-studio.service.ts`, `shared/form-studio-crew.ts`, `StudioMountNotice`, the rail and panel branches) is the model to follow.

---

## 2. The model

- A **production** belongs to an organization. It may belong to a room (`crew_session_id`) and a Project Space (`project_id`). It has a title, an aspect ratio and a budget ceiling.
- **Storyboard:** a production has ordered **scenes**, and each scene has ordered **plot points** (beats).
  - A plot point has **keyframe** renders (still images). One can be selected; one can be approved.
- **Film:** each scene has ordered **shots**. A shot may come from a plot point, and its approved keyframe is then the shot's reference frame.
  - A shot has **takes** (video renders). At most one take per shot is approved.
- **Assembly:** a scene's approved takes, in shot order with their transitions, stitch into a **reel**.
- **Assets:** every image, video and reel is an **asset** in storage. The platform serves assets itself, so playback never depends on a provider URL that expires.

Money is stored in **integer cents**. Drizzle's `decimal` returns strings.

### 2.1 Tables (migration 0115, journal `when` after 1786871200000)

```
media_productions  id, organization_id, project_id?, crew_session_id? (set null), title,
                   aspect_ratio, budget_limit_cents, created_by, created_at, updated_at
media_scenes       id, production_id (cascade), organization_id, position, scene_key, title, synopsis
                   unique (production_id, scene_key)
media_plot_points  id, scene_id (cascade), organization_id, position, title, beat
media_keyframes    id, plot_point_id (cascade), organization_id, prompt, status, provider, mode,
                   cost_cents, image_asset_id? (set null), approval_id?, error, is_selected,
                   requested_by, decided_by, created_at, updated_at
media_shots        id, scene_id (cascade), organization_id, position, plot_point_id? (set null),
                   prompt, negative_prompt, camera_motion, seed, duration_seconds, transition,
                   reference_keyframe_id? (set null)
media_takes        id, shot_id (cascade), organization_id, take_number, prompt, camera_motion, seed,
                   status, mode (live|simulation), generation_id, video_asset_id? (set null),
                   cost_cents, defect_class, notes, approval_id?, requested_by, decided_by,
                   created_at, updated_at
                   unique (shot_id) where status = 'approved'
media_assets       id, organization_id, kind (image|video|reel), storage_path, mime_type, byte_size,
                   duration_seconds?, width?, height?, source, created_at
media_assemblies   id, scene_id (cascade), organization_id, status (assembling|ready|failed),
                   manifest jsonb, reel_asset_id? (set null), error, requested_by, created_at, updated_at
```

**Take status:**
- A live take moves through `pending_approval → queued → rendering → ready_for_review → approved | rejected`, or ends as `failed`.
- A take whose render was rejected at approval is `rejected` with no render.
- A simulation take is `simulated` and never has a video.

**Spend:** the sum of `cost_cents` over live takes and keyframes that were actually submitted. It is checked against the ceiling when a render is requested.

---

## 3. Phases

### Phase 0 — Stop the false claims, wire the room (small)

Server:
- `seedance_submit_shot` in simulation returns no video URL. It says `mode: "simulation"`, and `check_status` reports `simulated` rather than `completed` with a URL.
- `assemble_scene_timeline` reports that assembly is not set up yet instead of a fake success. Phase 4 replaces it.

Room wiring:
- Add `mount_media_studio` to the crew ARTIFACT_TOOLS and the agent list.
- Add `media_studio_pod` to `RICH_PAYLOAD_TYPES`.
- Give `StudioMountNotice` a media kind.
- In `AgentChatPanel`: a media mount key, dismiss, `hasStudioActive`, and pass visibility and close to the rail.
- Remove the dead `CrewRailHub` `media` kind.

Studio:
- Remove the demo storyboard, the invented footer and the placeholder beds.
- Show an empty state that says how to start.

Tests: an artifact from real tool output reaches the rail; simulation output carries no URL.

### Phase 1 — Persistence and serving

- The migration above, a schema file (`shared/schema/media-studio.ts`) and `media-studio.service.ts`.
  - Every read and write is scoped to the organization by equality.
  - A production in a private Project Space is visible only to that project's members, using the same checks as Form Studio.
- Routes at `/api/media-studio` (productions, scenes, plot points, shots, takes). A production can be created from a room.
- `GET /api/media-studio/assets/:id`:
  - Checks the organization.
  - Streams from `storageService` with HTTP Range support, so `<video>` can seek.
- Integration tests on the test database: organization and project scoping, one approved take per shot, and Range responses.

### Phase 2 — Storyboard sequencer (keyframes for scenes and plot points)

- Deck mode becomes **Storyboard**. It shows scenes as sections and their plot points as ordered slides, and you can:
  - add, reorder (drag or keyboard) and edit a plot point's beat and keyframe prompt;
  - pick a keyframe;
  - approve it.
- **Keyframe rendering** uses a new `gemini-image.service.ts`:
  - Gemini `generateContent` with an image response; the model comes from `GEMINI_IMAGE_MODEL`.
  - The image is saved as an asset.
  - A failure is recorded with its reason, not hidden.
- **Keyframe cost** counts against the production budget.
- **Export** the storyboard to PPTX with `pptxgenjs`, one slide per plot point with its keyframe and beat.
- **Promote** a plot point to a shot, carrying its approved keyframe as the shot's reference frame and its beat as the starting prompt.
- **Story** (migration 0116):
  - link the production to a Scribe manuscript;
  - create scenes from its stations, and link a scene to a station;
  - show its characters and locations.
- **Direction:** scenes have a location, time of day and mood; shots have framing, lens, camera movement and action.
- **Dialogue:** shots have ordered lines (speaker, line, delivery).
- **Prompt compiler** (`shared/media-prompt.ts`): the text the video model will receive, shown before any render. It warns about a speaker the manuscript does not have, dialogue too long for the shot, and a duration outside 4–15 seconds.

### Phase 3 — Shots and takes, with approval

- **Request a take** (a new take or a re-shoot):
  - Live mode creates the take as `pending_approval`, plus an approval request `kind: "media_take_render"`. The request shows the prompt, duration, estimated cost and remaining budget.
  - A request that would pass the budget ceiling is refused in words before anyone is asked.
  - Simulation mode (no key) creates a `simulated` take straight away, labelled as such.
- **On approval**, `processDecision` submits to Seedance and marks the take `queued`.
  - The request goes to fal.ai Seedance with:
    - the compiled prompt;
    - the reference keyframe as `image_url`;
    - the next plot point's approved keyframe as `end_image_url`, when there is one.
  - Rejection marks the take `rejected` and records who decided.
- **Status:**
  - Takes in flight are refreshed from Seedance when the studio reads them, and by `seedance_check_status`.
  - A finished take's video is downloaded into storage as an asset before it shows as `ready_for_review`.
- **Dailies:**
  - Approving a take un-approves any other take of that shot.
  - Rejecting records a defect class and notes, and can request a re-shoot. That is a new take and a new approval.
- **Agents:** `seedance_submit_shot` goes through the same request path, so an agent can never spend without approval. The Seedance tools record takes through the service with the caller's organization, and the in-memory simulation store goes. (Moved here from Phase 1: recording a take needs this request path.)
- **As built (2026-09-13):**
  - Migration 0117 adds `media_takes.provider`, `request` (exactly what was or would be sent) and `provider_state`, and raises a new production's budget to $100. At fal.ai's list price a 5-second take costs $1.52 at 720p, so $25 covered too few takes to shoot a scene.
  - The adapter is `server/domain/media-studio/core/video-provider.ts`, using `@fal-ai/client` 1.10.1. Env: `FAL_KEY`, `FAL_SEEDANCE_RESOLUTION` (720p or 1080p), and endpoint overrides.
  - The budget check counts takes still waiting for approval, and runs again at approval.
  - Keyframes are uploaded to fal storage for one day, because the platform's own asset URLs need sign-in.
  - Ending on the next keyframe is opted into per take; it is not automatic.
  - A render is followed every 10 seconds, and again whenever the studio reads the production. A render still unfinished after 30 minutes is marked failed.
  - A render fal refused, or never ran, costs nothing.
  - The approver is the person who asked for the take. An agent's request with no signed-in person is refused.

### Phase 4 — Assembly with ffmpeg-static

- Add `ffmpeg-static` and call its binary through `child_process.spawn`. `fluent-ffmpeg` is deprecated and is not used.
- A pure `buildAssemblyPlan()` turns a scene's approved takes into ffmpeg arguments:
  - normalize resolution and frame rate to the production's aspect ratio;
  - concat for cuts;
  - `xfade` for crossfade and dip-to-black.
  - It is unit-tested on argument output.
- Assembly **is refused in words** when a shot has no approved take, or when an approved take has no video (a simulation).
- It runs in the background as a `media_assemblies` row, one at a time per organization.
  - The reel is saved as an asset.
  - A failure records ffmpeg's error.
- `assemble_scene_timeline` calls the same service.
- **As built (2026-09-13):**
  - `ffmpeg-static` 5.3.0 bundles ffmpeg 6.1.1. `core/ffmpeg.ts` spawns it and reads a clip's length and streams from `ffmpeg -i`, so no ffprobe is needed. `FFMPEG_PATH` points at another binary. With no binary, assembly is refused in words.
  - `core/assembly-plan.ts` builds the plan:
    - Clips are letterboxed into the production's frame, at the takes' resolution on the short side, in even pixels.
    - Every clip is converted to 24 fps, yuv420p and stereo 48 kHz. A take with no sound gets a silent track.
    - Crossfades last 0.75 s and dips to black 1 s. Both shorten to half the shorter shot.
    - A shot's transition leads into the next shot.
  - Migration 0118 adds a partial unique index, so a second request made at the same moment is refused.
  - A heartbeat runs every minute. A reel left "assembling" for 15 minutes is marked failed, which frees the slot.
  - `SceneView.assembly` shows the latest reel. Its `current` flag turns false once an approved take, the shot order or a transition changes.
  - `sceneAssemblyProblem` gives the refusal wording. It is shared, so the client and the server say the same thing.
  - The tool takes a scene id, or a production id plus scene key. It no longer takes clip URLs.
  - The Film tab has a Reel panel with Assemble, progress, the player and the failure reason.
  - Deployment: the Dockerfile's `npm ci` runs install scripts, so the image build downloads the Linux binary from GitHub.

### Phase 5 — The studio on real data

- `MediaStudioPod` loads the production over react-query. It has three tabs, **Storyboard | Shots & Dailies | Timeline**.
- **Playback:** one timeline clock. Each shot's offset maps timeline time to the take's own time, so the scrubber, seek and shot changes stay in step. It plays served assets.
- **Honest display:**
  - A/B compare uses real takes.
  - Budget and spend come from the database.
  - Every status comes from the row.
  - The screen shows only what exists.
- **Focus in chat:** "focus in chat" sends a `[Media Studio selection: {...}]` scope like Form Studio's, wired into the selection types, the HUD label and the scope prefix.
- **As built (2026-09-13):**
  - Loading over react-query and honest statuses already came in Phase 2.
  - The tabs stay Story, Storyboard, Shots and Film; the Film tab holds the dailies and the timeline.
  - **One clock:**
    - When a take ends, the next shot plays. On the last shot, playback stops.
    - A shot with no video, such as a simulation, still takes its length on the clock, so the playhead and the shot on screen stay in step.
    - Loop now means "loop this take" and is off by default.
  - **A/B compare:**
    - Compares against another take of the shot that has video: the approved take first, then the nearest earlier take.
    - The compared video follows the same play state and position. Before, it sat on its first frame.
  - **Honest display:**
    - The header shows spend against the budget, and "Takes simulate" when there is no `FAL_KEY`.
    - A take shows a cost only once its render was sent, not while it is an estimate.
  - Transitions change from the Film timeline and are saved with `PATCH /shots/:id`.
  - **Focus in chat:**
    - A discuss button sits on scenes (Story), plot points (Storyboard), shots (Shots), takes (Film dailies) and reels.
    - `MediaStudioSelection` is `{productionId, sceneId, sceneKey, kind, id, label}`. The ids are the ones the Media Studio tools take.
    - The rail maps it to a `type: 'media'` selection, and the HUD shows it with its own accent, noun, prefix and summary.
    - A selection from another production is dropped when the studio switches production.

### Phase 6 — CREW

- `mount_media_studio` opens a production by id or title. With neither, it opens or creates the room's production. It takes no budget or spend arguments.
- A direct path in `crew-media-studio.service.ts` opens the studio when a message asks for Media Studio or the storyboard.
- A film topic in the server `DIVERSE_TOPIC_DEFINITIONS` mounts the studio through `mount_media_studio`, not the packaged registry.
- Agents can draft plot points as a card you approve, the same shape as Form Studio's change proposal. They never write the storyboard directly.
  - **Built early (2026-09-13), wider than planned.** A message marked in the studio that asks for a change becomes a `media_change_proposal` card.
  - The card can edit scene direction, add, rewrite or remove plot points and shots, and change dialogue.
  - **Apply** sends `Apply media change "<id>".` The server saves the card's own edits, and only if a digest of the scene still matches.
  - **Guards:** edits can name only the scene's own plot points and shots. A plot point with rendered keyframes, or a shot with takes, is never removed. Unchanged fields are dropped.
  - Questions and review-only requests stay with the room. A change request needs the marker.
  - The transcript shows the marker as a chip instead of JSON.
- Productions appear on the Project Space as resources.
- **As built (2026-09-13):**
  - `mount_media_studio` takes `productionId`, `productionTitle`, `create`, `aspectRatio` and `sceneId`.
    - With neither id nor title, it opens the room's latest production, or the studio's start form. A plain "open" never creates a production.
    - `create` reuses a production in the room with the same title, so a retried card does not start two.
  - The direct path opens the studio when a message says "media/film/video studio", or asks to open the storyboard, shot list or dailies.
  - **Film playbook:** a "Make a Film (Media Studio)" Goal Playbook, with the packaged `FilmBriefPod` asking for title and aspect ratio.
    - Its DIVERSE intake is read by `parseFilmIntake` and starts the production through `mount_media_studio`.
    - It is listed in both `DIVERSE_TOPIC_DEFINITIONS` and the client fallback.
  - **Project Space:** a Media tab, not a `project_resources` type, because productions already carry `project_id`. `GET /api/projects/:key/media` backs it.

---

## 4. Decisions still open (my defaults in bold)

- **D1 — Keyframe renders and approval.** **Keyframes render without approval but count toward the budget**, since a still costs cents. Alternative: the same approval as video takes.
- **D2 — Reference frame sent to Seedance. Settled 2026-09-13:** fal.ai's Seedance takes the keyframe as `image_url` and an optional `end_image_url`. It has no seed or camera parameters, so camera direction is written into the prompt.
- **D3 — Where assembly runs.** **In the API process, one at a time per organization.** Alternative: a queue on the worker fleet, which needs a worker restart to deploy.
- **D4 — The uncommitted WIP.** **Keep the components and rework them onto real data** rather than starting over.

## 5. Out of scope for now

- Audio stems: dialogue, ambience and score synthesis and mixing. The timeline shows no audio tracks until a stem exists.
- Multi-scene master assembly across scenes. Phase 4 stitches one scene.
- Providers other than Seedance for video, and other than Gemini for keyframes.
