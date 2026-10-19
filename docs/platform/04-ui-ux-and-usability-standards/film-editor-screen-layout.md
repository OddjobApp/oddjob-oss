---
id: film-editor-screen-layout
title: Film Editor Screen Layout — Zones, Component Placement and the Editing Loop
audience: [HUMAN_PRIMARY, HYBRID]
badge: HUMAN_PRIMARY
category: 04-ui-ux-and-usability-standards
autonomy_level: L0-L2
version: 1.0.0
tags: [media-studio, film, timeline, layout, nle, viewer, inspector, ux]
summary: The four-zone layout the Media Studio film screen should hold — browser, viewer, inspector, timeline — how today's components map onto it, and the one data-model change the editing model needs.
verification_status: guidance
applies_when:
  - Changing where a Media Studio film surface lives on screen
  - Adding a panel, rail or modal to the film editing experience
  - Deciding whether a control belongs to a clip, a scene or the production
do_not_use_when:
  - Working on the storyboard or keyframe surfaces, which are authoring, not editing
implementation_evidence:
  - client/src/modules/media/MediaStudio.tsx
  - client/src/modules/media/MediaStudioPod.tsx
  - client/src/modules/media/components/MediaTimelineSequencer.tsx
  - server/domain/media-studio/core/assembly-plan.ts
---

# Film Editor Screen Layout `[🧑 HUMAN]`

> **Audience:** `🧑 Human / Builder` &nbsp;|&nbsp; **Classification:** UI/UX standard &nbsp;|&nbsp; **As of:** 2026-09-17

The film screen should hold four zones that are all visible at once — **browser, viewer, inspector, timeline** — because editing is a loop between two of them: move the playhead, watch the frame, mark the point, trim. Today those two sit in one scrolling column, so the loop spans a scroll. That is the single change worth making; everything below follows from it.

---

## 1. What the established editors do

Every professional editor converges on the same arrangement, and it is worth copying rather than re-deriving.

| Zone | Premiere Pro | Final Cut Pro | Responsibility |
| --- | --- | --- | --- |
| Browser | Project panel (left) | Sidebar + Browser (upper left) | The material available: clips, takes, projects |
| Viewer | Source + Program monitors (top centre) | Viewer (upper centre) | One frame, watched. Source = a clip; Program = the cut |
| Inspector | Effect Controls / properties | Inspector (right) | What the current selection *is*, and its settings |
| Timeline | Timeline (below the monitors) | Timeline (bottom, full width) | The cut itself, in time |

Two rules travel with that layout:

1. **Two monitors, not two players.** A source monitor shows one clip and is where in and out points are set; a program monitor shows the assembled sequence. They are the same surface in two modes, side by side, never stacked apart.
2. **The inspector follows the selection.** Select a clip and it shows the clip; select nothing and it shows the sequence. A panel whose contents never change with selection is a settings page, not an inspector.

Final Cut adds the magnetic model Oddjob already borrows: a **primary storyline** where clips close gaps automatically, and **connected clips** (B-roll, titles, sound) that hang off it. The critical detail is in §4.

---

## 2. Where the film screen stands today

`FilmTab` (`MediaStudio.tsx`) stacks four independent blocks in one scrolling column, and the editor itself is nested three levels down inside a component still named "pod".

| Component | Today | Problem |
| --- | --- | --- |
| Scene picker + status filter chips | `FilmTab` header | Duplicates the scope toggle inside the pod: two places decide what you are looking at |
| `SceneReel` | Block 1 of the column | A second video player, far from the first |
| `SceneBatchReview` | Block 2 | A review queue wedged between the reel and the editor |
| `MediaStudioPod` | Block 3, `min-h-[660px]` | Holds canvas + inspector + timeline; no longer a pod |
| `MediaStageCanvas` | Inside the pod | The real viewer, but only for takes |
| `MediaDailiesInspector` | Inside the pod, stacked | A/B comparison is a viewer mode, not a third block |
| `MediaTimelineSequencer` | Inside the pod, below everything | Below the fold on a laptop — the reason scrubbing feels broken |
| `MediaGraphViewer` | Inside the pod, alternate mode | Correct as a mode; wrong that it replaces the whole editor |
| `ShotsPanel` | A different tab | This is the browser. It should sit beside the timeline, not replace it |
| `MediaConfigurationRail` | CREW right rail | Closest thing to an inspector, but tied to the room and never follows selection |
| `TransitionInspectorPopover` | On the clip | Right idea, wrong container — belongs in the inspector, with the popover as the shortcut |

Two further splits worth naming: **duration is editable in two places** with different meanings (`ShotsPanel` edits `durationSeconds`; the timeline edits trims and holds), and **`MediaStudioPod` is load-bearing** — the same component serves the in-chat card and the full editor, which is why it carries a fixed minimum height into a scrolling parent.

---

## 3. The target layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ Toolbar: production · scene/film scope · engine · cut reel · exit     │
├───────────────┬──────────────────────────────────┬───────────────────┤
│ BROWSER       │ VIEWER                           │ INSPECTOR         │
│ scenes        │  ┌ source ┬ program ┬ compare ┐  │ selection-driven: │
│ shots         │  │  take  │  reel   │  A/B    │  │  clip · scene ·   │
│ takes         │  └────────┴─────────┴─────────┘  │  production       │
│ (drag to      │  transport · timecode            │                   │
│  timeline)    │                                  │                   │
├───────────────┴──────────────────────────────────┴───────────────────┤
│ TIMELINE (full width, always visible)                                │
│  V2 connected clips ·  V1 primary storyline ·  A1–A4 audio           │
└──────────────────────────────────────────────────────────────────────┘
```

Rules for the zones:

- **The viewer and the timeline are never separated by a scroll.** The page does not scroll; each zone scrolls internally. This is the whole point.
- **One viewer, three modes.** Source (the selected take), Program (the assembled reel), Compare (A/B split-wipe, today's dailies inspector). `SceneReel`'s player and `MediaStageCanvas` merge here.
- **The inspector answers "what is selected".** Clip: transition and its length, trims, hold, track, prompt. Scene: title, slugline, style. Production: engine, model, aspect ratio, budget — i.e. today's `MediaConfigurationRail`.
- **The browser is the Shots tab, docked.** Scene list, shot list, takes per shot, with filter chips. The Shots *tab* can remain as a full-width editing surface for prompts, but the film screen keeps its own docked copy.
- **The review queue is a drawer,** opened from the toolbar, over the timeline. It is a task list, not a permanent third of the screen.
- **The graph is a viewer mode or a drawer,** not a replacement for the editor.

---

## 4. The model change: connect cutaways to a shot, not to a second

This is the one place where today's data model diverges from the editors it copies, and it will produce wrong cuts.

`media_shots.start_time_seconds` (migration 0123) stores a V2 overlay's position as an **absolute offset in the timeline**. Final Cut's connected clips instead attach to a **point in a primary clip**: "When you move a clip in the primary storyline, all of its connected clips move with it, keeping your edit in sync."

With absolute offsets, trimming any earlier V1 shot by half a second silently slides every cutaway half a second late. The cutaway lands on the wrong line of dialogue, and nothing on screen says so.

**Done (migration 0125).** A connected clip stores `(anchor_shot_id, anchor_offset_seconds)` — the shot it hangs off, and how far into that shot it begins. `shotTimelineStarts` in `shared/media-studio.ts` resolves the absolute time, and is the single answer used by both the timeline on screen and the manifest the reel is cut from; two implementations of that is how a cut stops matching the timeline that approved it. `start_time_seconds` remains as the fallback for overlays made before the migration. The anchor must be a primary shot in the same scene, and moving a clip back to track 1 clears both the anchor and the stored second, so there is never a second answer to where it sits.

---

## 5. What generative video changes

The four zones hold, but three assumptions behind them do not. In an editor, footage exists, is finite, and is free to cut. Here it does not exist until it is asked for, it is exactly as long as the model made it, and every new frame costs money and minutes.

### Assumptions that break

| NLE assumption | Here | What the UI owes |
| --- | --- | --- |
| You cut what you shot | A shot has a duration and a prompt before it has any take | Clips render as intent — keyframe thumbnail, prompt, duration — and hold their slot through planned → queued → rendering → ready → approved |
| Trim handles pull from unused media | A take is exactly `sourceDurationSeconds` long; there is nothing either side | Dragging past the edge must change meaning visibly: trim, then freeze-hold, then "render a continuation". One is free, the next two are not |
| A bad shot is fixed by cutting around it | It is fixed by rendering it again with one thing changed | The inspector's first action is reshoot-with (seed, prompt delta, reference, model); trim is secondary |
| A clip has one source | A clip has a stack of takes | Take switching is a timeline operation with the playhead parked — A/B the same frame, without moving in time |

### What an editor has no concept of

1. **Price and time before the click.** Every generative action shows its cost and queue ETA where it is invoked, against the production's remaining budget. Reversible edits (trim, reorder, transition) and billable ones (render, reroll, continuation) get different affordances, because undo means something different for each.
2. **Asynchronous editing as the normal state.** A render takes minutes to over half an hour, so the cut is never fully "loaded". Pending clips hold their place and show progress in situ; the person is told where they are when it lands, not only inside the room they left.
3. **Continuity as a visible property.** Each clip carries what produced it — style-bible version, character and wardrobe references, seed, workflow, model — and flags drift: a shot rendered before the bible changed is a risk even though nothing about it is wrong.
4. **Recipe provenance and reuse.** Copying the recipe of a shot that worked onto one that did not is one action. Determinism gets explicit controls: same seed / new prompt, same prompt / new seed, seed locked across a scene.
5. **Generated B-roll is a request, not a file.** A connected clip may be an empty anchored gap with a prompt, filled later. This is another reason to anchor cutaways to a shot (§4): a cutaway survives its anchor being re-rendered at a different length; an absolute offset does not.
6. **Engine asymmetry belongs on screen.** Local ComfyUI is free and slow; fal is billed and fast, and that changes whether people render variants speculatively. The engine reads in the viewer chrome, and a local take reads "free (local)", never "0".

---

## 6. Every workflow the screen has to carry

Checked against the code on 2026-09-17. "Works" means reachable and wired end to end; a gap is named where the surface exists but the path does not.

| Flow | State |
| --- | --- |
| Cold start → production → scene → shots | Works |
| Story-first: Scribe manuscript → scenes → drift and re-sync | Works, but drift is visible only in the Story tab |
| Shot authoring: prompt, framing, lens, duration, reference keyframe | Works, in the Shots tab — not yet docked beside the timeline |
| Request a take → queued → rendering → ready | Works; progress is visible only for the take in the viewer |
| Simulation when no engine is configured | Works |
| Approve, reject with a defect class, reroll with a prompt delta | Works, from the dailies inspector |
| A/B compare two takes at the same moment | Works |
| Batch review across a scene | Works |
| Assemble the reel, watch it, see it go out of date | Works |
| Scene vs master-film scope | Works, one control since this document |
| Transitions and their length, trims, freeze-holds | Works and persists (migration 0123) |
| Split a clip at the playhead | **Gap** — local only; needs a server-side split, since duplicate drops takes |
| Reorder clips by dragging | **Gap** — the drag type exists, mouse-up never calls `onReorderShots` |
| Create a cutaway on V2 | Works — drag a clip onto the overlay lane and it hangs off the shot it was dropped over; drag it back to rejoin the cut |
| Generate or reroll from the timeline | **Gap** — both require leaving for the Shots tab |
| See cost and ETA where the action is taken | **Gap** — the estimate lives in the Shots tab only |
| Audio mix | **Gap** — the four lanes are synthesised in `MediaStudio` with `audioUrl: ""`; mute and solo are local state |
| Continuity: bible, wardrobe, anchors, drift | Exists, but nowhere on the film screen |
| Leave mid-render and come back | Works — a render notification names the room; reopening the studio is a second step |
| Room proposals: change, story, style bible cards | Works |
| Export the storyboard, share a link | Works |

### The rail, with tabs

The remaining crowding goes to the right rail, which frees the centre entirely for viewer and timeline and retires the bounded reading region that stage 1 introduced.

| Rail tab | Holds | Built from |
| --- | --- | --- |
| Clip | The selected clip: prompt, framing, transition and its length, trims, hold, track, cost, and reshoot-with | New; `TransitionInspectorPopover` stays as the on-clip shortcut |
| Scene | Scene meta, style, the assemble action and why it cannot cut | `SceneReel` |
| Production | Engine, model, workflow, aspect ratio, budget | `MediaConfigurationRail`, `VideoEngineSection` |
| Queue | Renders in flight with progress and ETA, and the review queue | `SceneBatchReview` plus render progress |
| Continuity | Bible, wardrobe, character anchors, drift against the current bible | `ProjectStyleBibleCard`, `VisualContinuityDiffModal` |

Order of work: **Clip** first — it closes the two gaps that cost the most per day, generating and rerolling where you are looking, with the price on the button. Then **Queue**, then cutaway creation, which lands with the anchoring change in §4 rather than before it.

---

## 7. Staged plan

Each stage is shippable on its own and leaves the screen working.

1. **Pin the timeline.** Make `FilmTab` a non-scrolling flex column: viewer region above, timeline below, each scrolling internally. Nothing moves between components. This alone fixes the editing loop.
2. **One viewer.** Fold `SceneReel`'s player and `MediaDailiesInspector` into `MediaStageCanvas` as Source / Program / Compare modes. `SceneReel` keeps the cut-the-reel action, which moves to the toolbar.
3. **Dock the browser.** Render the shot and take list from `ShotsPanel` as a left column on the film screen, sharing the selection state the timeline already holds.
4. **Selection-driven inspector.** Give `MediaConfigurationRail` a clip mode and a scene mode; move the transition controls into it and keep `TransitionInspectorPopover` as the on-clip shortcut.
5. **Queue to a drawer.** `SceneBatchReview` opens over the timeline from a toolbar button with a count.
6. **Anchor connected clips** (§4), and rename `MediaStudioPod` to what it has become — the editor — leaving the in-chat card as a thin wrapper.
7. **Cost and ETA at the point of the click**, with billable actions visually distinct from reversible ones (§5).
8. **Pending clips hold their place** in the timeline, with render progress in situ (§5).

Stages 1–2 remove the reported problem (the timeline below the fold, two competing players). Stages 7–8 need no migration and change day-to-day behaviour most, because they turn the wait — the property no editor has to solve — into something legible. Stage 6 is the only one that needs a migration.

---

## Sources

- [Final Cut Pro for Mac interface](https://support.apple.com/guide/final-cut-pro/final-cut-pro-interface-ver92bd100a/mac) — browser, viewer, timeline, sidebar, inspector and where each sits
- [Intro to the Magnetic Timeline in Final Cut Pro](https://support.apple.com/guide/final-cut-pro/intro-to-the-magnetic-timeline-verb8fcfc133/mac) — primary storyline, connected clips, and clips moving in sync
- [Source and Program Monitor overview in Premiere](https://helpx.adobe.com/premiere/desktop/get-started/source-and-program-monitor-adjustments/about-source-monitor-and-program-monitor.html) — the two-monitor model
- [The Premiere Pro Interface Guide](https://blog.nobledesktop.com/learn/premiere-pro/premiere-pro-interface-guide) — panel responsibilities and the default editing workspace
