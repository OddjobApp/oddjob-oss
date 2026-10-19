# 🏗️ App Forge Hub

The **App Forge Hub** is an industrial-grade command center for the autonomous and manual scaffolding of agentic mini-applications within the Oddjob ecosystem. It bridges high-level mission objectives with containerized application deployment.

## **Overview**
Located at `/apps/forge`, the Hub provides a dedicated workspace for users to select blueprints, configure application manifests, and monitor real-time assembly processes. Prior to the Hub, app creation was limited to a modal-based workflow; the Hub elevates this into a strategic, multi-step orchestration experience.

## **Core Workflow**

### **1. Blueprint Selection**
Users browse a gallery of 8 application archetypes. Each blueprint defines the structural scaffold, pre-wired platform proxy, and AI codegen directives.

| Slug | Name | Category |
|------|------|----------|
| `analytics-dashboard` | Analytics Dashboard | Analytics |
| `chat-assistant` | Chat Assistant | Communication |
| `crud-app` | CRUD App | Productivity |
| `api` | API | Integration |
| `spa` | Single Page App | General |
| `pwa` | Progressive Web App | Mobile |
| `rescue-dispatch` | Rescue Dispatcher | Mission Critical |
| `mission-supervisor` | Mission Supervisor | Mission Critical |

All blueprints include `pages/api/oddjob/[...path].ts` — a pre-wired proxy that forwards calls to the Oddjob platform using `ODDJOB_APP_TOKEN`.

### **2. Mission & Strategic Context**
The Hub allows for deep integration with the **Missions System**.
- **Mission Linking**: Applications can inherit the goals, data, and context of an active mission.
- **AI Personalization**: Users can refine the system prompt that will govern the new application's behavior.

### **3. Application Manifesting**
Users define the technical identity of the app:
- **Name**: The display name in the marketplace.
- **Slug**: The URL-safe identifier for routing.
- **Description**: Public-facing marketing copy for the app.

### **3a. Platform Services (Optional)**
Users can pre-wire platform resources at forge time. These are injected into both `oddjob.manifest.json` and the AI's `platformContext`, so generated code references real resource IDs rather than placeholders:
- **Pipelines** (`allowedPipelineIds`) — pipelines the app can trigger via `POST /api/oddjob/pipelines/execute`
- **Datasets** (`allowedDatasetIds`) — datasets the app can query via `POST /api/oddjob/datasets/platform/:id/query`
- **Collections** (`defaultCollections`) — default `appRecords` collection names for CRUD operations

## **Platform API — Full Route Reference**

All routes are reached through the app's `pages/api/oddjob/[...path].ts` proxy using `ODDJOB_APP_TOKEN`.

| Method | Route | Scope | Description |
|--------|-------|-------|-------------|
| GET/POST/PUT/DELETE | `/datasets?collection=X` | `datasets` | App-scoped record CRUD |
| POST | `/datasets/platform/:id/query` | `datasets` | Query org-level Oddjob dataset |
| POST | `/missions/trigger` | `missions` | Launch an existing mission by name |
| **POST** | **`/missions`** | `missions` | **Create + launch a new mission** |
| **GET** | **`/missions/:runId/status`** | `missions` | **Poll a mission run** |
| **POST** | **`/jobs`** | `missions` | **Create a scoped agent job** |
| POST | `/pipelines/execute` | `pipelines` | Execute a pre-wired pipeline |
| GET | `/pipelines/:runId/status` | `pipelines` | Poll a pipeline execution |
| POST | `/schedules` | `schedules` | Create a cron-triggered schedule |
| POST | `/hil` | `hil` | Raise a HIL approval form |
| GET | `/hil/:formId/poll` | `hil` | Poll HIL form status |
| GET | `/knowledge/query?q=` | `knowledge` | Search the knowledge graph |
| POST | `/telemetry` | — | Log a telemetry event |

**Bold rows** are new as of Apr 2026. The `/missions` create+launch route caps `budgetLimitUsd` at $1.00 server-side.

### **4. Real-time Forge Console**
Once a "Forge Ignition" is triggered, the Hub provides a terminal-like interface (`ForgeConsole`) that streams:
- **Codegen Logs**: Progress from the AI code generation service.
- **Build Logs**: Docker build outputs and npm installation progress.
- **Status Indicators**: Real-time feedback on build success or failure.

## **Technical Components**

### **Frontend**
- **`AppForge.tsx`**: The main page coordinator and step-wizard.
- **`BlueprintGallery.tsx`**: Presentation layer for available architectures.
- **`ForgeConsole.tsx`**: SSE/Polling-based terminal for process monitoring.

### **Backend Services**
- **`appForgeService`**: Orchestrates the interaction between blueprints and the codegen engine.
- **`forgeCodegenService`**: The primary LLM-driven service that generates the application codebase.
- **`dockerBridgeService`**: Manages the isolated container environments for building and testing forged apps.

## **Security & Governance**
All apps forged via the Hub are subject to Oddjob's security enforcement protocols:
- **Isolated Runtimes**: Every app lives in its own container sandbox.
- **Manifest Injection**: Security headers and identity configurations are injected at build time.
- **Audit Logging**: Every forge event is captured in the system's global audit log.

## **MCP Integration**
The App Forge supports programmatic interaction via the MCP `forge` handler, allowing AI agents to:
- `list_blueprints`: Discover available architectures.
- `forge_app`: Trigger a new build from a mission wave.
- `get_forge_status`: Monitor progress programmatically.
