# Scribe Studio Documentation

> **Spec References:**
> - [SCRIBE_STUDIO_SPEC](../../docs/CALCULATION_NODES.md)
> - Oddjob 5-Layer AI Control Plane (`.agent/skills/oddjob-5layer-ai-control-plane/SKILL.md`)
> - Distributed Tracing & Forensic Logging (`.agent/workflows/distributed-tracing-implementation.md`)

---

## **Feature Overview**

### **Purpose & Business Value**
Scribe Studio is Oddjob's real-time, AI-augmented collaborative living document authoring environment. It transforms static document drafting into an interactive, staged production cycle where autonomous advisor agents (Ghostwriters, Critics, Continuity Sentinels, and Domain Experts) collaborate with human authors. Scribe Studio replaces disjointed document reviews with in-pod living canvas authoring, structured outline progression ("Subway Spine"), ambient continuous quality feedback, and non-destructive copilot synthesis.

### **User Personas & Use Cases**
- **Product Managers & Authors**: Drafting PRDs, specifications, briefs, and whitepapers with continuous AI feedback and outline generation.
- **Autonomous Agent Crews**: Multi-agent advisory panels providing real-time critique, drafting proposals, fact verification, and structural advice during execution cycles.
- **Reviewers & Editors**: Evaluating manuscripts in focus mode, selecting scoped excerpts, triggering targeted rewrites, and reviewing diff proposals in the Critic Gallery.
- **Operations & Compliance**: Publishing finalized living manuscripts into canonical project deliverables with cryptographic file blobs and tamper-evident audit attachments.

### **Key Requirements & Constraints**
- **Multi-Tenant Org Scoping**: Strict organization isolation on every query and mutation via `getOrgConditions` / `requireOrgId()`.
- **Non-Destructive Authoring**: Section mutations preserve existing authored prose while maintaining title heading anchors (`# Title\n\n`) and station sort orders.
- **Surgical Text Excerpting**: Ghostwriter edits support targeted excerpt replacement (`targetExcerpt` -> `replacementExcerpt`) rather than blind station overwrites.
- **Dual Document Viewing**: Seamless switching between Single Station view and Continuous Manuscript view without losing editor state or scroll position.
- **Rendered Markdown & Rich HTML**: WYSIWYG HTML formatting capabilities with dynamic toggle between rich rendering and raw editing, plus one-click copy as Markdown.
- **Z-Layer Integrity**: Floating toolbars, selection pills, and focus overlays must never obscure global privacy/compliance banners or viewport dialogs.

### **Success Metrics**
- **Surgical Insertion Accuracy**: 100% match rate when applying excerpt-targeted rewrites; immediate rejection when excerpt text drifts.
- **Outline & Heading Synchronization**: 0% drift between Subway Spine station titles and document markdown heading anchors.
- **Handover Latency**: < 50ms from highlight selection click ("Ask GhostWriter") to chat uncollapse, draft population, and visual scoped focus establishment.
- **Zero Accidental Overwrites**: Complete audit history of node revisions with rollback capability.

---

## **User Interface Documentation**

### **Screens & Navigation**

#### **1. Scribe Studio Pod View (`/workspace/chat/:sessionId` -> Embedded Studio Pod)**
- **Purpose**: Main living document authoring interface integrated directly alongside the Crew chat panel.
- **Layout**: 4-pane modular split layout:
  - **Left Rail (Subway Spine)**: Vertical station navigation showing draft progress, word counts, current station, and outline reordering.
  - **Center Canvas (Living Document Canvas)**: WYSIWYG rich editor and rendered markdown preview with floating formatting toolbar and selection quick-actions.
  - **Right Rail (Critic & Revision Gallery)**: Ambient linting issues, structural suggestions, and one-click accept/reject diff cards.
  - **Bottom Shelf (Studio Dock)**: Fast actions (In-Pod Copilot Auto-Synthesis, Add Section, Reconcile Outline, Publish Deliverable).

#### **2. Focus Mode View (Maximized Editor)**
- **Purpose**: Distraction-free, full-width canvas hiding side rails and collapsing the chat rail.
- **Transitions**: When text is selected in Focus Mode and "Ask GhostWriter" is clicked, chat smoothly uncollapses, pre-populates the prompt composer with excerpt context, and maintains a visible emerald focus halo over the canvas.

### **Component Hierarchy**

```
client/src/modules/scribe/
├── ScribeStudioPod.tsx                      # Root Studio container & 4-pane layout
├── components/
│   ├── LivingDocumentCanvas.tsx            # Editor/Preview, rich toolbar, selection pill, focus halos
│   ├── SubwaySpineRail.tsx                 # Vertical station navigation, progress dots, reordering
│   ├── CriticGalleryRail.tsx               # Linting cards, structural proposals, diff reviews
│   ├── StudioDockShelf.tsx                 # Fast actions, auto-copilot trigger, publish button
│   └── ScribeExportDialog.tsx              # Markdown/PDF export configuration
client/src/components/agent-chat/
├── AgentChatPanel.tsx                      # Crew chat rail, listens to scribe:focus-chat
└── ModularAssemblyPuzzleRail.tsx           # Pod-to-Chat assembly rail and un-collapse bridge
```

### **User Interactions**

1. **Station Navigation**:
   - Clicking any station node on the Subway Spine scrolls the canvas directly to that section in continuous mode, or switches the active station in single-station mode.
2. **Text Highlighting & GhostWriter Handover**:
   - Highlighting prose triggers a floating action pill (`Ask GhostWriter`, `Copy Markdown`, `Format`).
   - Clicking **Ask GhostWriter** captures the excerpt, anchors the start/end offsets, sets a persistent emerald highlight (`<mark className="bg-emerald-400/30">`), un-collapses the chat panel via `scribe:focus-chat`, and loads a contextual prompt into the composer.
3. **Inserting Draft into Station**:
   - In chat, when an agent responds with proposed prose, an **"Insert Draft into Station"** button appears.
   - Clicking it executes a surgical in-place replacement or appends to the station, refreshing the canvas without remounting.
4. **Rich HTML & Rendered Markdown Modes**:
   - Toggle between **Rendered View** (clean typography, active headings, tables) and **Edit Mode** (floating formatting toolbar for bold, italic, lists, code, blockquotes).
   - Floating toolbar maintains viewport pinning during long-document scrolling.

### **Responsive Design**
- **Desktop (>= 1280px)**: Full 4-pane expanded view with synchronized scroll.
- **Tablet / Split View (768px - 1279px)**: Subway spine collapses to an icon rail; Critic Gallery collapses to a slide-over drawer.
- **Mobile (< 768px)**: Single active pane with top segment switch (Outline, Editor, Chat, Reviews).

---

## **API Documentation**

### **Endpoint Specifications**

| Method | Endpoint | Purpose | Scope |
|--------|----------|---------|-------|
| `GET` | `/api/scribe/documents/:sessionId` | Retrieve active living document and all station nodes | Multi-tenant (`orgId`) |
| `POST` | `/api/scribe/documents/:sessionId/initialize` | Initialize or reset manuscript with an archetype framework | Multi-tenant (`orgId`) |
| `PATCH` | `/api/scribe/nodes/:nodeId` | Surgically update station content, title, or status | Multi-tenant (`orgId`) |
| `POST` | `/api/scribe/documents/:sessionId/toc` | Auto-generate or synchronize Table of Contents | Multi-tenant (`orgId`) |
| `POST` | `/api/scribe/documents/:sessionId/configure-stations` | Reconfigure outline structure and custom stations | Multi-tenant (`orgId`) |
| `POST` | `/api/scribe/documents/:sessionId/reconcile-copilot` | Execute In-Pod Copilot Auto-Synthesis from chat turns | Multi-tenant (`orgId`) |
| `POST` | `/api/scribe/documents/:sessionId/publish` | Publish manuscript to project deliverable & attachment blob | Multi-tenant (`orgId`) |

### **Request/Response Schemas**

#### **PATCH `/api/scribe/nodes/:nodeId`**
```json
// Request Body
{
  "title": "Problem Statement",
  "content": "# Problem Statement\n\nUsers struggle with fragmented drafting...",
  "targetExcerpt": "Users struggle with fragmented drafting...",
  "replacementExcerpt": "Teams frequently encounter severe friction with fragmented drafting...",
  "status": "drafted"
}

// Response Body (200 OK)
{
  "success": true,
  "node": {
    "id": 5485,
    "documentId": 213,
    "title": "Problem Statement",
    "content": "# Problem Statement\n\nTeams frequently encounter severe friction with fragmented drafting...",
    "status": "drafted",
    "sortOrder": 1,
    "wordCount": 142,
    "updatedAt": "2026-09-10T17:48:18.000Z"
  }
}
```

### **Error Handling & Status Codes**
- `400 Bad Request`: Missing mandatory parameters or invalid archetype.
- `404 Not Found`: Station node or document not found within tenant.
- `409 Conflict`: Target excerpt not found in current station text (preventing stale race condition overwrites).
- `403 Forbidden`: Cross-tenant access attempt.

---

## **Component Architecture**

### **State Management Patterns**
- **Living Document State**: Managed via TanStack Query (`queryKey: ['/api/scribe/documents', sessionId]`) with optimistic updates on station content changes.
- **Scoped Excerpt Selection**: Maintained locally in `LivingDocumentCanvas` (`focusedExcerpt`) and broadcast globally via typed custom DOM events.
- **Cross-Component Event Bus**:
  - `window.dispatchEvent(new CustomEvent('scribe:focus-chat', { detail: { selection } }))`
  - `window.dispatchEvent(new CustomEvent('scribe:clear-focus'))`

### **Prop Interfaces & Data Models**

```typescript
export interface ScribeExcerptSelection {
  nodeId: number;
  stationTitle: string;
  excerptText: string;
  startOffset?: number;
  endOffset?: number;
  timestamp: number;
}

export type ScribeIntentType = 'structural' | 'content' | 'both' | 'none';

export interface ScribeActionIntent {
  type: ScribeIntentType;
  confidence: number;
  isTocRequested: boolean;
  isOutlineRequested: boolean;
  isDraftRewrite: boolean;
  extractedStations?: string[];
  targetStationHint?: string;
}
```

---

## **Integration Points**

### **Agent Tools & Capabilities (`server/domain/tools/v1/capabilities/scribe.ts`)**
- `scribe_get_document`: Reads manuscript structure and content without mutating state.
- `scribe_add_table_of_contents`: Derives TOC from existing nodes, inserts a TOC station, and aligns headings.
- `scribe_configure_stations`: Restructures outline, inserts new stations, and preserves existing node content.
- `scribe_update_node`: Executes surgical excerpt replacement or full station draft updates.

### **In-Pod Copilot Auto-Synthesis (`ScribeCopilotService`)**
- Automatically reconciles recommendations from multi-agent chat rounds.
- Extracts numbered outlines directly from advisor messages, synthesizing a unified outline proposal without overwriting human author modifications.

### **Database Dependencies**
- `scribe_documents`: Root manuscript entity linked to `sessionId` and `organizationId`.
- `scribe_nodes`: Section/station entities with `title`, `content`, `sortOrder`, `status`, and `metadata`.
- `scribe_annotations`: Critic issues, continuity warnings, and user comments anchored to specific character offsets.

---

## **Testing Requirements**

### **Automated Vitest Test Suites**
- `server/domain/scribe/tests/scribe-studio.test.ts`: End-to-end service and tool execution contracts.
- `server/domain/scribe/tests/scribe-copilot.test.ts`: Outline reconciliation and copilot synthesis.
- `server/domain/intent-router/core/tests/scribe-intent-resolver.test.ts`: Tri-modal intent classification (`structural`, `content`, `both`).
- `client/src/modules/scribe/components/LivingDocumentCanvasInsert.test.tsx`: Surgical draft insertion into living stations.
- `client/src/modules/scribe/components/LivingDocumentCanvasRich.test.tsx`: Rich HTML rendering, floating toolbar, and copy as Markdown.

---

## **Documentation References**
- **Related Specs**: [`CALCULATION_NODES.md`](../../docs/CALCULATION_NODES.md)
- **Central Index**: [`SUMMARY.md`](./SUMMARY.md)
- **Agent Skill Guide**: `oddjob-5layer-ai-control-plane` (`.agent/skills/oddjob-5layer-ai-control-plane/SKILL.md`)
