# Scribe Rail Design QA

- Source visual truth: a pasted screenshot (not kept)
- Implementation screenshot: `work/scribe-rail-qa/implementation-wide.png`
- Side-by-side comparison: `work/scribe-rail-qa/comparison.png`
- Source pixels: 2559 × 1468, including approximately 95 px of browser chrome
- Implementation pixels: 2559 × 1373 browser viewport, device scale factor 1
- Normalization: implementation was bottom-aligned into a 2559 × 1468 comparison frame to account for source browser chrome
- State: dark theme, Scribe Studio mounted, split chat/studio view, wide desktop

## Full-view comparison evidence

The source showed the Scribe rail beginning below the Crew header but extending below the viewport, clipping the Telemetry Dock and export controls. The revised implementation constrains the fixed rail between its measured header bottom and a 16 px viewport inset. At 2559 × 1373 the rail ends at y=1357.3 and the dock ends at y=1356.7, fully inside the viewport.

At the default 1280 × 720 viewport, the original composition also exceeded the viewport width and pushed the Scribe rail to x=-134. The revised responsive composition hides Supervisor and Blackboard below the 2xl breakpoint while Scribe is active. The rail then occupies x=522–1258, with no horizontal document overflow and its dock ending at y=703.3 inside the 720 px viewport.

## Focused region comparison evidence

The bottom Telemetry Dock was inspected separately because it was the clipped functional region. It is now a non-shrinking 52 px dock at laptop width, with horizontally scrollable export controls and a wide-screen EKG that yields at tighter widths. The Scribe header and three-pane center were also checked: long manuscript titles truncate, the canvas can shrink, and the two side rails use narrower widths until the 2xl breakpoint.

## Findings and iteration history

1. **P1 — Telemetry and export dock clipped below viewport**
   - Earlier evidence: fixed rail child used `h-[85vh]` despite starting below a variable-height room header.
   - Fix: fixed rail now has `bottom: 16`; Scribe uses `h-full min-h-0` throughout.
   - Post-fix evidence: dock bottom is 1356.7 in a 1373 px viewport and 703.3 in a 720 px viewport.

2. **P1 — Scribe pushed off-screen at laptop width**
   - Earlier evidence: combined Scribe, Supervisor, and Blackboard width placed the Scribe rail at x=-134 in a 1280 px viewport.
   - Fix: Supervisor and Blackboard yield below 2xl while Scribe is mounted; Scribe uses a clamped split-view width.
   - Post-fix evidence: Scribe x=522, width=736, right edge=1258 in a 1280 px viewport.

3. **P2 — Inner pane density and toolbar overflow**
   - Earlier evidence: fixed 288 px and 320 px side panes left insufficient canvas width; the full EKG and export set competed for footer width.
   - Fix: responsive 240/256 px side panes below 2xl, `min-w-0` canvas/header containment, truncation, and an overflow-safe dock.
   - Post-fix evidence: all three working panes remain visible and interactive at 1280 px; the footer stays within the rail.

## Required fidelity surfaces

- Fonts and typography: existing Oddjob mono/serif hierarchy preserved; truncation prevents title collisions.
- Spacing and layout rhythm: source composition preserved at wide desktop; bottom inset and responsive yielding remove clipping.
- Colors and visual tokens: existing zinc/emerald Scribe tokens preserved with no new palette drift.
- Image quality and asset fidelity: no raster or custom visual assets are part of this rail; existing icon-library assets remain unchanged.
- Copy and content: all Scribe, manuscript, critic, telemetry, and export copy is unchanged.

## Interaction and runtime checks

- Verified the authenticated Crew room in a browser-rendered local session.
- Confirmed the rail and dock bounding boxes at 1280 × 720 and 2559 × 1373.
- Confirmed no browser console errors.
- Confirmed chat transcript and Scribe remain simultaneously usable in split view.

## Follow-up polish

- P3: a future pass could offer manual resizing between chat and Scribe, but it is not required to resolve the current layout defects.

final result: passed
