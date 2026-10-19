# S.C.O.R.E. Interactive Walkthrough Authoring Runbook

This runbook guides engineers and technical writers in authoring, testing, and publishing interactive guided walkthroughs across the Oddjob platform using the **S.C.O.R.E.** engine (**S**electors, **C**ontext, **O**rchestration, **R**esilience, **E**mpathy).

Walkthrough playlists are protected by automated CI drift detection (`npm run test:drift`).

---

## 1. Authoring Workflow Overview

Adding an interactive tour involves 4 straightforward steps:
1. **DOM Anchor Placement**: Add a stable `data-tutorial="<id>"` attribute to the target UI element.
2. **Playlist Registration**: Define the steps in [`shared/tutorials/registry.ts`](../../shared/tutorials/registry.ts).
3. **Trigger Exposure**: Connect the tour to Copilot tools, the Component Gallery, and URL query params.
4. **Drift Verification**: Run `npm run test:drift` to verify routing, element selectors, and metadata validity.

---

## 2. Step 1: Placing Stable DOM Anchors

Never target unstable CSS class names or arbitrary child selectors. Always attach a descriptive `data-tutorial` attribute:

```tsx
// client/src/pages/operations/OperationsConsolePage.tsx
<button
  type="button"
  data-tutorial="operations-quick-trigger"
  onClick={handleQuickTrigger}
  className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 font-medium"
>
  Quick Launch Cycle
</button>
```

---

## 3. Step 2: Registering the Step in Registry

Open [`shared/tutorials/registry.ts`](../../shared/tutorials/registry.ts) and add the step to the appropriate playlist:

```typescript
export const MY_NEW_PLAYLIST: TutorialPlaylist = {
  id: "platform-observability-tour",
  title: "Platform Observability & Metrics Tour",
  description: "Walks through live telemetry, log streaming, and H3 hexagonal incident mapping.",
  category: "Observability",
  route: "/observability",
  estimatedMinutes: 3,
  steps: [
    {
      id: "obs-telemetry-panel",
      title: "Real-Time Telemetry Stream",
      description: "Inspect live WebSocket telemetry metrics streamed directly from worker agents.",
      selector: '[data-tutorial="obs-telemetry-panel"]',
      placement: "bottom",
      route: "/observability",
      spotlightPadding: 8,
      advanceOn: "click"
    },
    {
      id: "obs-h3-heatmap",
      title: "Hexagonal Spatial Heatmap",
      description: "Filter telemetry alerts across geospatial Uber H3 cells.",
      selector: '[data-tutorial="obs-h3-heatmap"]',
      placement: "top",
      route: "/observability",
      spotlightPadding: 12
    }
  ]
};
```

---

## 4. Step 3: Enabling Omnichannel Triggers

Walkthroughs can be launched through 4 distinct entry points:

1. **Global Command Palette (`Ctrl+K`)**:
   - Registered in [`CommandPalette.tsx`](../../server/domain/core/ui/components/shared/CommandPalette.tsx) under the `Guided Tours` section.
2. **Copilot LLM Rich Card**:
   - The Copilot LLM tool `launch_score_tutorial` accepts `{ tutorialId: "platform-observability-tour" }` and renders an interactive invitation card in [`AgentChatSheet.tsx`](../../server/domain/core/ui/components/layout/AgentChatSheet.tsx).
3. **Component Style Gallery Card**:
   - Any component in [`ComponentStyleGallery.tsx`](../../server/domain/knowledge/ui/modules/knowledge/pages/ComponentStyleGallery.tsx) matching a tutorial displays a **"▶ Live Demo"** button.
4. **Direct URL Query Link**:
   - Deep-link directly into the walkthrough via `http://localhost:5000/observability?tutorial=platform-observability-tour`.

---

## 5. Step 4: Testing & Preventing Drift

Ensure the tutorial passes the automated drift test:

```bash
npm run test:drift
```

### What `test:drift` verifies:
* All playlist `route` properties map to real client-side routes.
* Every step `selector` adheres to the `[data-tutorial="..."]` contract.
* Playlist IDs are unique, valid, and non-empty.
* Cross-route steps define necessary navigation preconditions.
