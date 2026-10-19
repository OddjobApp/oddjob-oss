# App Studio — Builder Feature Documentation

## Cycle Blueprint Builder integration

App Studio participates in a governed round trip from a selected Cycle phase:

1. Cycle Builder saves the draft plus source draft and phase identifiers.
2. App Forge and App Detail preserve that return context through creation and publishing.
3. Publishing returns the exact app ID, deployment ID, release reference, publication state, and launch route.
4. Cycle Builder verifies that the source draft and phase still exist, writes the binding with optimistic concurrency, selects the affected phase, and reruns readiness.
5. A conflict preserves the return payload and asks the author to reconcile the changed draft rather than silently attaching the app.

Only installed, published, organization-scoped deployments can be bound to executable Cycle app steps. Runtime Cycles retain the deployment and release identity used during readiness. Unpublishing or replacing a bound deployment should therefore be treated as a governed compatibility change.

## Overview

### CREW selection sharing and change history

When Studio is mounted beside CREW, **Discuss this file in CREW**, **Discuss this
component in CREW**, and **Discuss diagnostics in CREW** place a context chip in
the conversation and reveal it if collapsed. They do not submit a message.
The next message carries the app ID, selection kind, file path or visual node ID
when available, and last observed change timestamp. That timestamp is not a
published release identifier. File contents and raw logs are not copied into the
chip. Visual selections refer to the editor's component nodes, not arbitrary
elements inside the preview iframe.

Context metadata is read-only in the composer. App context is cleared when the
room, mounted app, Studio visibility, or observed change identity changes.

**Change history** is reconstructed from the loaded conversation's persisted
App Studio artifacts and filtered to the current app. It shows the instruction,
outcome, and file count when available, with **Show conversation** and **Discuss
change** actions. Redelivered dispatches are deduplicated by their recorded change
timestamp; repeated instructions with different timestamps remain separate.
It is a history of recorded room changes, not a complete workspace version log.
Historical entries do not offer independent rollback. The latest-change banner
continues to report the existing undo availability.

Coverage: `shared/app-studio-context.test.ts`, `client/src/modules/apps/AppStudioPod.test.tsx`,
and the existing CREW rail regression tests.

The App Studio is the developer-facing IDE embedded inside the Armory app detail page (`/armory/apps/:id`). It replaces the original two-panel chat-and-iframe layout with a full three-column environment providing scaffold inspection, live preview, service wiring visibility, and access to all Oddjob primitives from a single surface.

The Studio is only visible to the app's developer org (`app.developerOrgId === selectedOrgId`).

---

## Layout

```
┌──────────────┬────────────────────────────────┬────────────────────┐
│  NAVIGATOR   │          PREVIEW               │   STUDIO PANEL     │
│  (208px)     │          (flex)                │   (360px)          │
│              │                                │                    │
│  Scaffold    │  [ Preview | Logs | File ]     │  Chat │ Prim │ Wire│
│  ─ file tree │  ┌──────────────────────────┐  │                    │
│              │  │                          │  │  tab content       │
│  Plumbing    │  │  iframe / log stream /   │  │                    │
│  ─ services  │  │  file viewer             │  │                    │
│              │  └──────────────────────────┘  │                    │
└──────────────┴────────────────────────────────┴────────────────────┘
```

The page container expands from `max-w-5xl` to `max-w-[1800px]` while the Builder tab is active, then returns to normal when switching away.

---

## Panels

### Left — Navigator

**Scaffold section** (top half)

A collapsible file tree built from the app's forge workspace at `storage/forge-workspace/:slug`. Files are colour-coded by extension:

| Extension | Colour |
|-----------|--------|
| tsx / jsx | blue |
| ts / js | yellow |
| css | pink |
| json | green |
| md | grey |

- Directories expand/collapse on click
- Clicking a file opens it in the File Viewer mode in the center panel
- The refresh button re-fetches the tree (e.g. after an AI enhancement writes new files)
- `node_modules`, `.next`, `dist`, `.git`, `.turbo`, `.cache` are always hidden

**Plumbing section** (bottom half)

A compact read-only summary of the app's live service connections:

| Row | Source field |
|-----|-------------|
| Mission | `deployment.oddjobMissionId` |
| Knowledge | `deployment.allowedTopicIds.length` |
| Datasets | `deployment.allowedDatasetIds.length` |
| Pipeline | `deployment.nextPipelineId` |
| Tools | `deployment.allowedTools.length` |
| HIL | `deployment.hilEnabled` |
| Model | `deployment.defaultModel` |

Green icon = wired. Grey icon = not configured.

---

### Center — Preview

**Mode toggle bar**

Three modes, toggled by the segmented control at the top:

| Mode | Content |
|------|---------|
| Preview | Live iframe pointing to `/forged/:slug`. Sandboxed with `allow-scripts allow-same-origin allow-forms allow-popups`. |
| Logs | Live container log stream via `EventSource` on `GET /api/apps/:appId/logs`. Auto-scrolls, ring-buffered to 500 lines. |
| File | Read-only file viewer populated from `GET /api/apps/:appId/files/content?path=`. Activated by clicking a file in the Navigator. |

**Status indicators**

- Container status pill (Running / Offline) with animated pulse when live
- URL bar showing the app's public preview URL or selected file path
- Manual reload button (appears when container is running)

**Rebuild overlay**

During an AI enhancement (`POST /api/apps/:appId/enhance`), a full-panel overlay shows rebuild progress. The iframe only reloads once `runtimeMetadata.status` transitions to `"running"` post-rebuild — not on HTTP response receipt.

---

### Right — Studio Panel

Three tabs:

#### Chat

Natural language interface to `POST /api/apps/:appId/enhance`. The AI:
1. Snapshots the forge workspace (max 20,000 chars, skipping files that would overflow rather than truncating)
2. Sends the snapshot + UI palette manifest to the configured LLM
3. Receives a `{ relPath: fileContent }` map
4. Writes changed files to the workspace
5. Rebuilds the Docker image and restarts the container

The chat message on success shows how many files were updated (e.g. "Applied (3 files updated). Container restarting…"). The iframe reloads automatically once the container comes back online.

Press `Enter` to submit (without Shift).

#### Primitives

A browsable catalog of all Oddjob agent tools and UI components.

**Tool Groups** (10 groups, 250+ tools total):

| Group | Count | Examples |
|-------|-------|---------|
| Knowledge | 22 | `search_unified_knowledge`, `search_knowledge_graph` |
| Operations | 18 | `trigger_pipeline`, `monitoring_query_metrics` |
| GitHub | 7 | `github_list_prs`, `github_create_issue` |
| Microsoft 365 | 7 | `teams_post_message`, `outlook_send_email` |
| Monitoring | 6 | `monitoring_get_incidents`, `monitoring_trigger_alert` |
| Cloud | 3 | `cloud_invoke_function`, `cloud_read_logs` |
| Web & SaaS | 45 | `browse_web`, `google_search` |
| Data | 12 | `sql_query`, `dataset_query` |
| Utility | 8 | `current_time`, `python_execute` |
| AI & Copilot | 6 | `CopilotKit`, `FormRenderer` |

Each group is collapsible. Inside, each tool has a **Wire It →** button that pre-fills the chat input with a contextual prompt and switches to the Chat tab.

**UI Component Groups** (7 groups):

| Group | Components |
|-------|-----------|
| Layout | Card, Tabs, Sheet, Accordion, Resizable, ScrollArea, Separator, Sidebar |
| Data Visualization | Chart, Table, Progress, Stat, Calendar, Carousel |
| Interactive | Dialog, Popover, Command, Drawer, Tooltip, HoverCard, MenuBar |
| Inputs | Button, Input, Select, Checkbox, Switch, Slider, Textarea, Form |
| Feedback | Toast, Alert, Skeleton, Badge, Avatar |
| AI & Workflow | CopilotKit, CopilotSidebar, CopilotPopup, FormRenderer, MarkdownEditor |
| Maps & Location | RescueMap, LocationInput |

Clicking any component chip pre-fills the chat with an "Add a [Component] for…" template.

- Components in **Layout → AI & Workflow** import from `@domain-ui/core/ui/components/ui/[component-name]`.
- `RescueMap` imports from `@domain-ui/rescue/ui/modules/rescue/components/RescueMap` and requires `VITE_MAPBOX_ACCESS_TOKEN`.
- `LocationInput` imports from `@domain-ui/core/ui/components/ui/location-input`.

#### Wiring

Read-only cards showing the app's full service configuration, sourced from `GET /api/apps/:appId/deploy`. Each card shows:
- The service name and linked value (or "not configured" italic)
- A green `CheckCircle2` icon when active

Covers: Mission Link, Knowledge Topics, Datasets, Pipeline on Complete, Tool Scope, HIL Forms, AI Model, Access Policy.

The **Open Full Configuration** button switches the AppDetail page to the Publish tab for full editing.

---

## API Endpoints

### `GET /api/apps/:appId/files`

Returns the workspace file tree for the scaffold navigator.

**Auth:** `requireOrgAdminOrSuper`

**Response:**
```json
{
  "slug": "my-app",
  "tree": [
    {
      "name": "pages",
      "path": "pages",
      "type": "dir",
      "children": [
        { "name": "index.tsx", "path": "pages/index.tsx", "type": "file", "ext": "tsx", "size": 2048 }
      ]
    }
  ]
}
```

Returns `{ "tree": null, "slug": "..." }` if no workspace exists for the app.

Skipped directories: `node_modules`, `.next`, `dist`, `.git`, `.turbo`, `.cache`.

Tree is sorted: directories before files, both alphabetically.

---

### `GET /api/apps/:appId/files/content?path=`

Returns the raw content of a specific file in the workspace.

**Auth:** `requireOrgAdminOrSuper`

**Query params:**
- `path` (required) — relative path within the workspace (e.g. `pages/index.tsx`)

**Response:**
```json
{
  "path": "pages/index.tsx",
  "content": "import React from 'react';\n..."
}
```

**Security:** Rejects any `path` that resolves outside the workspace root (path traversal protection).

---

## MCP / Agent Tools

Three new tools in the `App Forge` group expose the Studio programmatically to agents:

### `studio_list_files`

Lists the file tree for a forged app by slug.

```typescript
// Parameters
{ slug: string }

// Returns
{ slug: string, tree: FileNode[] }
```

### `studio_read_file`

Reads a specific file's content from the workspace.

```typescript
// Parameters
{ slug: string, filePath: string }

// Returns
{ slug: string, path: string, content: string }
```

### `studio_enhance_app`

Applies an AI-driven code change to the app, rebuilds, and restarts.

```typescript
// Parameters
{ appId: number, instruction: string }

// Returns
{ success: boolean, filesWritten: number, error?: string }
```

These tools are available to any agent that has the `App Forge` skill category in scope.

---

## Known Limitations (Phase 1)

- **Primitives tab** shows a representative sample of tools per group (3 examples), not the full list. Full tool browsing comes in Phase 2.
- **Wiring tab** is read-only. Inline editing of service connections is planned for Phase 3.
- **Diff view** (showing changed files before applying) is planned for Phase 4.
- **Plumbing graph** (visual node topology) is planned for Phase 5.
- The manifest inspector (`oddjob.manifest.json` structured form editor) is planned for Phase 5.

---

## Security Notes

- The file content endpoint performs path traversal validation: `fullPath.startsWith(workspacePath)`. Any path resolving outside the workspace returns 400.
- The iframe preview uses `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"` to prevent forged app JS from accessing `window.parent`.
- Workspace file writes (during enhance) are similarly path-validated in `app-builder.service.ts`.

---

## CSP / Preview Proxy Notes

The preview iframe works through the Mach 3 proxy at `preview-proxy.ts`:

- Routes `GET /forged/:slug/*` → `localhost:ASSIGNED_PORT/*`
- Strips `x-frame-options` and `content-security-policy` from the proxied response
- Sets `frame-ancestors 'self'` on the response (allows embedding from same origin)
- The Builder page itself gets `frame-src 'self'` in its CSP from `security-headers.ts`, enabling it to load the iframe

Development Vite also injects `frame-src 'none'` via meta tags; `vite.ts` strips these via regex on the HTML template before serving.
