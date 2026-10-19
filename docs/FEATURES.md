# Oddjob Platform Features Documentation

## Table of Contents
1. [App Version Control](#app-version-control)
2. [Multi-Agent Architecture](#multi-agent-architecture)
3. [Self-Improving Blueprints](#self-improving-blueprints)
4. [Selenium QA Automation](#selenium-qa-automation)
5. [Knowledge Graph Visualization](#knowledge-graph-visualization)
6. [Swarm Task Marketplace](#swarm-task-marketplace)
7. [Graph RAG & Knowledge Extraction](#graph-rag--knowledge-extraction)
8. [Event-Driven Xray Composition Indexing](#event-driven-xray-composition-indexing)
9. [Orchestration Thinking & Mission Critique Engine](#orchestration-thinking--mission-critique-engine)
10. [AI Steering Vector Control & Snapshot Management](#ai-steering-vector-control--snapshot-management)
11. [Cycle Blueprint Builder](#cycle-blueprint-builder)
12. [Platform Blocks Reference](#platform-blocks-reference)
13. [Dynamic Scaffold Assembly Engine](#dynamic-scaffold-assembly-engine)
14. [CREW Multi-Agent Rooms](#crew-multi-agent-rooms)
15. [Calculation Nodes Integration](#calculation-nodes-integration)
16. [Formal Verification & Synthesis Control Plane](#formal-verification--synthesis-control-plane)
17. [Agora Multi-Agent Deliberation Rooms](#agora-multi-agent-deliberation-rooms)
18. [Autonomous Agent PIP Self-Healing Loop](#autonomous-agent-pip-self-healing-loop)
19. [Eulerian Hexagonal (Uber H3) Spatial Command Deck](#eulerian-hexagonal-uber-h3-spatial-command-deck)
20. [Unified App Lifecycle: Forge → Builder Studio → Direct Publish](#unified-app-lifecycle-forge--builder-studio--direct-publish)
21. [Balanced 3-Column CREW Workspace & Unified Agentic App Forge](#balanced-3-column-crew-workspace--unified-agentic-app-forge)
22. [S.C.O.R.E. Governed Walkthroughs, Live Demos & Self-Maintaining Architecture](#score-governed-walkthroughs-live-demos--self-maintaining-architecture)
23. [Governed AI Film Production & ComfyUI Media Studio](#governed-ai-film-production--comfyui-media-studio)
24. [Computer Use, Human Takeover & Learned Skills](#computer-use-human-takeover--learned-skills)

---

## App Version Control

Git-like version control system for forged apps.

### Features
- **Commit History**: Track every change to app source code
- **Diff Viewer**: Compare any two versions side-by-side
- **One-Click Rollback**: Restore app to any previous version
- **Branch Support**: Create experimental branches
- **Tagging**: Mark stable releases

### Usage
```tsx
import { AppVersionControlBlock } from "@domain-ui/packaged";

// In your component
<AppVersionControlBlock 
  appId={123}
  appSlug="my-app"
  showDiff={true}
  maxVersions={20}
  onRollback={(versionId) => console.log("Rolled back to", versionId)}
/>
```

### API Endpoints
- `POST /api/versions` - Create new version (commit)
- `GET /api/versions?appId={id}` - List version history
- `POST /api/versions/rollback` - Rollback to version
- `GET /api/versions/diff?from={v1}&to={v2}` - Compare versions

### Service Methods
```typescript
appVersioningService.commit(appId, sourcePath, {
  message: "Fixed login bug",
  author: "user@example.com",
  branch: "main"
});

appVersioningService.rollback(appId, versionId, targetPath);
```

---

## Multi-Agent Architecture

Distributed AI task execution with specialized agents.

### Agent Roles
| Role | Responsibility | Tasks |
|------|---------------|-------|
| **Architect** | System design | `design_architecture` |
| **Coder** | Code generation | `write_code`, `fix_bugs` |
| **Reviewer** | Code review | `review_code` |
| **Tester** | Quality assurance | `run_tests` |
| **Specialist** | Optimization | `optimize`, `document` |

### Workflow Example
```typescript
import { agentCoordinator } from "@domain/agents/core/agent-coordinator.service";

// Register agents
await agentCoordinator.registerAgent("CodeMaster", "coder", ["react", "typescript"]);
await agentCoordinator.registerAgent("TestBot", "tester", ["e2e", "unit"]);

// Create workflow
const workflow = await agentCoordinator.createWorkflow(
  "Build Dashboard App",
  [
    { type: "design_architecture", payload: { requirements }, priority: "high" },
    { type: "write_code", payload: { blueprint: "analytics" }, priority: "high", dependencies: ["task-0"] },
    { type: "review_code", payload: {}, priority: "medium", dependencies: ["task-1"] },
    { type: "run_tests", payload: { type: "e2e" }, priority: "medium", dependencies: ["task-2"] }
  ],
  false // sequential
);
```

### Real-time Monitoring
```tsx
import { MultiAgentDashboardBlock } from "@domain-ui/packaged";

<MultiAgentDashboardBlock 
  title="AI Agent Fleet"
  showPerformance={true}
  autoRefresh={true}
/>
```

---

## Self-Improving Blueprints

Blueprints that learn from usage and suggest improvements.

### How It Works
1. **Metrics Collection**: Tracks success rate, build time, user satisfaction
2. **Issue Analysis**: Identifies common error patterns
3. **AI Suggestions**: Generates improvement recommendations
4. **Generation Management**: Creates new blueprint versions
5. **Approval Workflow**: Human-in-the-loop for improvements

### Metrics Tracked
- Total apps created
- Success rate (active vs failed)
- Average build time
- User satisfaction score
- Common issues by type/severity
- Most used features

### Usage
```tsx
import { BlueprintEvolutionBlock } from "@domain-ui/packaged";

<BlueprintEvolutionBlock 
  blueprintId="analytics-dashboard"
  showGenerations={true}
  autoAnalyze={true}
/>
```

### Service API
```typescript
// Collect metrics
const metrics = await blueprintEvolutionService.collectMetrics("analytics-dashboard");

// Generate suggestions
const suggestions = await blueprintEvolutionService.generateSuggestions("analytics-dashboard");

// Create new generation
const generation = await blueprintEvolutionService.evolveBlueprint(
  "analytics-dashboard",
  suggestions[0],
  "admin@example.com"
);

// Approve generation
await blueprintEvolutionService.approveGeneration(generation.id, true);
```

---

## Selenium QA Automation

Real browser testing for forged apps.

### Test Types
| Test | Description |
|------|-------------|
| **Page Load** | Verifies app renders correctly |
| **Console Errors** | Captures JavaScript errors |
| **Image Integrity** | Detects broken images |
| **Responsive Layout** | Tests 4 viewports (desktop, laptop, tablet, mobile) |
| **Interactive Elements** | Verifies buttons are clickable |

### Usage
```tsx
import { SeleniumRunnerBlock } from "@domain-ui/packaged";

<SeleniumRunnerBlock 
  appId={123}
  appSlug="my-app"
  autoRun={false}
  showHistory={true}
  maxHistory={5}
/>
```

### Service API
```typescript
import { seleniumRunnerService } from "@domain/apps/core/selenium-runner.service";

const audit = await seleniumRunnerService.runAudit(
  appId,
  "my-app",
  "http://localhost:3000",
  { browser: "chrome", headless: true, viewport: { width: 1920, height: 1080 } }
);

// Results
console.log(audit.results[0].consoleErrors); // Console errors
console.log(audit.results[0].brokenImages);  // Broken images
console.log(audit.results[0].layoutIssues);    // Layout problems
console.log(audit.results[0].screenshot);      // Base64 screenshot
```

---

## Knowledge Graph Visualization

Interactive graph exploration with Cytoscape.js.

### Features
- Force-directed layout (cose algorithm)
- Zoom/pan controls
- Node color coding by type
- Hover highlighting
- Click to view details
- Graph/List view toggle
- Relationship visualization

### Node Types
| Type | Color | Description |
|------|-------|-------------|
| Person | Blue | Individuals |
| Organization | Green | Companies/groups |
| Location | Amber | Places |
| Event | Red | Occurrences |
| Document | Purple | Files/records |
| Topic | Pink | Subject areas |
| Technology | Cyan | Tech/Tools |
| Concept | Slate | Abstract ideas |

### Usage
```tsx
import { PlatformKnowledgeSearchBlock } from "@domain-ui/packaged";

<PlatformKnowledgeSearchBlock 
  placeholder="Search knowledge graph..."
  defaultView="graph"
  height="600px"
  onNodeSelect={(node) => console.log("Selected:", node)}
/>
```

---

## Swarm Task Marketplace

Decentralized marketplace for agent swarm task bidding, allocation, capacity tracking, and settlement.

### Core Mechanisms
- **Decentralized Bidding**: Specialized agents evaluate incoming tasks and place automated bids based on persona capability and current workload.
- **Capacity Management**: Tracks active task allocations per worker node to prevent resource exhaustion.
- **Reward & Settlement**: Calculates task completion payouts based on execution time, token usage, and quality score.

### API Endpoints
- `GET /api/swarm/marketplace/tasks` — List active tasks available for bidding
- `POST /api/swarm/marketplace/bid` — Submit an agent bid for a task
- `GET /api/swarm/marketplace/capacity` — Query agent swarm capacity status

---

## Graph RAG & Knowledge Extraction

Advanced retrieval-augmented generation combining semantic vector search with multi-hop graph traversals.

### Key Capabilities
- **Multi-Hop Traversal**: Traverses entity-relationship paths to retrieve contextually linked documents.
- **Automated Extraction**: Parses raw unstructured text into typed nodes (Entities, Concepts, Tools) and weighted edges.
- **Hybrid RAG**: Fuses vector similarity search (Qdrant) with graph topology ranking.

### Core Services
- `server/domain/knowledge/core/rag/graph-rag.service.ts` — `GraphRagService`
- `server/domain/knowledge/core/extraction/knowledge-extraction.service.ts` — `KnowledgeExtractionService`

---

## Event-Driven Xray Composition Indexing

Real-time platform architecture exploration and component dependency mapping.

### Capabilities
- **Event Streaming**: Subscribes to backend domain lifecycle events via `xray-event-listener.ts`.
- **Spec Fingerprinting**: Computes structural checksums to detect component drift and API contract changes.
- **Dynamic Node Documentation**: Integrated live editor for node specifications, telemetry metrics, and dependency graphs.

---

## Orchestration Thinking & Mission Critique Engine

Multi-step decision reasoning traces and mission outcome evaluation.

### Capabilities
- **Thinking Traces**: Captures step-by-step model reasoning during dynamic mission execution (`thinking.service.ts`).
- **Mission Critique**: Automated post-execution evaluator analyzing deliverable quality against safety and governance guardrails (`mission-critique.service.ts`).

---

## AI Steering Vector Control & Snapshot Management

Intervention engine for controlling model behavior via activation steering.

### Features
- **Steering Vector Service**: Manipulates intermediate activation representations (`steering-vector.service.ts`).
- **Snapshot Manager**: UI console for inspecting, capturing, and restoring model memory snapshots and policy states (`SnapshotManager.tsx`).

---

## Cycle Blueprint Builder

Interactive canvas for authoring, testing, and governing operational cycle blueprints.

### Features
- **Visual Flow & Data Authoring**: Drag-and-drop node graph canvas ([VisualFlowCanvas.tsx](../client/src/modules/operations/components/VisualFlowCanvas.tsx)) for operational lifecycle planning with port-to-port typed data edges and step-through debugger controls.
- **Deterministic Pre-Flight Simulation Engine**: Static topological analysis, DAG acyclicity validation, port contract schema checking, and Monte Carlo P50/P95 duration & cost bounds (`POST /api/cycle-builder/drafts/simulate`).
- **Cryptographic Readiness Proof**: Generates a deterministic SHA-256 certificate (`VERIFIED`, `ACTION_REQUIRED`, `BLOCKED`) with a 0–100 readiness score and multi-pillar audit checklist.
- **Cross-Studio Availability Probes**: Deep validation across Workbench App deployments, Form Agents (`jobs.type = 'form_agent'`), Data Pipelines, and Prediction target objectives (`POST /api/cycle-builder/drafts/:id/readiness`).
- **Immutable Studio Release Manifest**: Automatically compiles participating studio dependencies into `operationalCycles.metadata.studioManifest` upon creation or revision publishing.
- **Runtime Recovery**: Restart-safe cycle execution engine with predecessor state migration.

See detailed documentation in [SIMULATION_AND_VERIFICATION.md](./cycle-builder/SIMULATION_AND_VERIFICATION.md).

---

## Platform Blocks Reference

### Complete Block Inventory (16 Total)

#### Phase 1 - Core Platform
| Block | Category | Self-Wiring API |
|-------|----------|-----------------|
| PlatformDatasetTableBlock | data | `/api/oddjob/datasets` |
| PlatformAgentChatBlock | ai | `/api/oddjob/agents/{id}/chat` |
| PlatformMissionsBlock | missions | `/api/oddjob/missions` |
| PlatformMissionLogBlock | missions | `/api/oddjob/missions/{id}/logs` |
| PlatformPipelineTriggerBlock | pipelines | `/api/oddjob/pipelines` |

#### Phase 2 - Extended Platform
| Block | Category | Key Features |
|-------|----------|--------------|
| PlatformDatasetChartBlock | data | Recharts visualization |
| PlatformFormBlock | forms | Dynamic form builder |
| PlatformKnowledgeSearchBlock | knowledge | Cytoscape graph viz |
| PlatformJobRunnerBlock | jobs | Job execution UI |
| PlatformHILApprovalBlock | workflows | Human-in-the-loop |
| PlatformPipelineStatusBlock | pipelines | Execution monitoring |
| PlatformDeadLetterQueueBlock | reliability | Failed job management |
| SeleniumRunnerBlock | testing | Browser automation |
| AppVersionControlBlock | versioning | Git-like version control |
| MultiAgentDashboardBlock | ai | Multi-agent orchestration |
| BlueprintEvolutionBlock | ai | Self-improving blueprints |

### Import Pattern
```typescript
// From packaged index
import { 
  PlatformDatasetTableBlock,
  PlatformAgentChatBlock,
  // ... etc
} from "@domain-ui/packaged";

// Or individual imports
import PlatformDatasetTableBlock from "@domain-ui/packaged/PlatformDatasetTableBlock";
```

---

## Event Stream Integration

All features emit real-time events via SSE.

### Event Types
```typescript
// Version Control
"version.commit"
"version.rollback" 
"version.branch"

// Multi-Agent
"agent.registered"
"agent.stale"
"task.submitted"
"task.started"
"task.completed"
"task.failed"
"workflow.created"
"workflow.completed"

// Blueprint Evolution
"blueprint.suggestions"
"blueprint.evolved"
"blueprint.generation.approved"
"blueprint.generation.rejected"

// Selenium
"selenium.audit.started"
"selenium.audit.completed"
"selenium.audit.failed"
```

### React Hook Usage
```typescript
import { useEventStream } from "@domain-ui/hooks/useEventStream";

const { events, isConnected } = useEventStream({
  type: ["agent.*", "task.*"],
  autoConnect: true
});

// Process events
useEffect(() => {
  events.forEach(event => {
    console.log(event.eventType, event.payload);
  });
}, [events]);
```

---

## Quick Start Checklist

- [ ] Install dependencies: `npm install cytoscape selenium-webdriver`
- [ ] Import required blocks from `@domain-ui/packaged`
- [ ] Configure event stream SSE endpoint
- [ ] Set up platform block slot tokens in blueprints
- [ ] Register API routes for new services
- [ ] Run verification: `npx tsx scripts/test/verify-structure.ts`

---

## Related Reference Docs

- [Error Codes Reference](./ERROR_CODES.md) — every machine-readable API error `code`, its HTTP status, and meaning.
- [Frontend Architecture](./frontend_architecture.md) — stack, module layout, providers, and the theming/semantic-token system.
- [Design System](./DESIGN.md) — visual language, palette, and light/dark ("Orbital"/"Atmospheric") theming.

---

## Support

For issues or questions:
- Check existing blueprints in `server/blueprints/apps/`
- Review platform block implementations in `server/domain/core/ui/components/packaged/`
- Run test suite: `npm test`

---

## Dynamic Scaffold Assembly Engine

Composable, AST-driven micro-application assembly engine using functional feature modules (`pack.json`) instead of rigid monolithic boilerplate templates.

### Features
- **Modular Feature Packs (`pack.json`)**: Versioned building blocks defining dependencies (`requires`), conflicts (`conflicts`), virtual capability slots (`provides`), and Handlebars templates.
- **Topological DAG Engine (`DAGResolver`)**: Kahn's algorithm for prerequisite execution ordering and conflict rejection.
- **AST Transformation Engine (`ASTRuleEngine`)**: Safe TypeScript code injection via `ts-morph` (`AST_ADD_IMPORT`, `AST_ADD_MIDDLEWARE`) and `MERGE_JSON` for `package.json`.
- **Atomic AST Rollback**: Snapshots workspace files before transformation, restoring pre-scaffold contents automatically on assembly errors.
- **X-Ray Component Graph Lineage**: Notifies `XrayCompositionService.reindexScope()` post-assembly to ingest new UI components, APIs, and datasets automatically.

### Feature Pack Manifest Example (`pack.json`)
```json
{
  "id": "auth-jwt",
  "name": "JWT Authentication Pack",
  "version": "1.0.0",
  "category": "auth",
  "extends": "core-node-express",
  "requires": [],
  "conflicts": ["auth-session"],
  "provides": ["auth-provider"],
  "inject": [
    {
      "target": "src/app.ts",
      "action": "AST_ADD_MIDDLEWARE",
      "import": "import { authMiddleware } from './middleware/auth.js';",
      "use": "app.use('/api', authMiddleware);"
    },
    {
      "target": "package.json",
      "action": "MERGE_JSON",
      "path": "dependencies",
      "content": { "jsonwebtoken": "^9.0.2" }
    }
  ]
}
```

### Usage
```typescript
import { scaffoldAssemblyService } from "@domain/scaffold/scaffold-assembly.service";

const result = await scaffoldAssemblyService.assemble({
  appName: "my-microservice",
  targetDir: "/path/to/workspace",
  packs: ["core-node-express", "auth-jwt"],
  variables: { port: 3000 }
});

if (result.success) {
  console.log("App assembled in topological order:", result.executedPacks);
}
```

---

## CREW Multi-Agent Rooms

A discussion room where several specialist agents debate a subject **with each other**, a human participates as a first-class speaker, and a Supervisor manages the conversation. Discussions are not disposable — they feed operational knowledge, raise issues, and reveal user intent.

Domain: `server/domain/crew`. UI: `client/src/components/agent-chat/AgentChatPanel.tsx` at `/workspace/chat/:roomKey`.

### Discussion Model
- **Multi-agent rounds**: agents speak sequentially so each sees what the previous ones said, producing genuine exchange rather than parallel replies to the user (`crew-orchestrator.service.ts`).
- **Subject-driven speaker selection**: who speaks is scored on topic/intent affinity using the Intent Router's classifiers; an explicit `@mention` overrides affinity entirely.
- **Supervisor**: critiques the weakest claim, states where consensus genuinely exists, summarises, creates plans, and introduces new intents. It also speaks into the room, addressing agents by `@mention` (`crew-supervisor.service.ts`).
- **Triage gate**: messages below a substance threshold get a single conversational reply instead of convening the crew — a greeting costs one model call, not four (`crew-triage.service.ts`).
- **Hand raising**: members who did not speak signal relevant experience, scored from affinity plus knowledge-graph hits with **no model call**.

### Grounding & Execution Contract

Agents may not claim work that did not run. The turn pipeline enforces this rather than relying on prompt instruction (`crew-speaker-turn.service.ts`, `crew-tools.service.ts`).

- **Evasion detection**: before a turn posts, the draft is checked against the calls that actually executed — fabricated third-party contact (no `send_*`/email tool), fabricated page visits (no successful `browse_web`/`attach_url`), fabricated search findings, `"Action Taken"`/`"Evidence Collected"` sections over zero successful calls, and self-servable option menus (`detectEvasion`). Present/future-tense narration (`"let's visit…"`, `"I will browse…"`) is flagged the same as past-tense claims.
- **Bounded repair**: an evasive draft gets one rewrite with the accusation named in plain language (`repairEvasion`). A rewrite that still evades is never posted — the turn is replaced with a factual fallback naming what ran: *"only search_unified_knowledge succeeded; browse_web (url: Required) failed"*, whether zero calls ran or an unrelated call succeeded.
- **Truthful tool outcomes**: calls that return an error payload rather than throwing are classified `ok: false`. Identical failing `(tool, args)` calls are deduplicated per turn — a repeat returns *"already failed; repeating cannot succeed"* instead of re-executing. Successful calls may still repeat.
- **Actionable validation errors**: invalid arguments report the bad fields **and** the declared parameter schema (`url: Required. Declared parameters: url: string (required), …`), so the next call fixes rather than guesses.
- **URL autofill**: when a URL-bearing tool is called without one, the URL is filled in precedence order — explicit valid argument, user message, the agent's own draft, recent transcript — but only into keys the tool declares (`url`, `source`, `endpoint`, `uri`). Private-network targets remain blocked by the egress firewall.
- **External-research routing**: explicit requests for live evidence — a supplied URL, "search the web", named external sources — force a retry restricted to `google_search`/`browse_web`/`attach_url` declarations when the first pass produced none (`isExplicitExternalResearchRequest`, `crew-round-context.ts`). If the retry still produces none, the turn posts a factual failure explanation — it is never blanked into silence.
- **Markdown tool-call interception**: a ```` ```json ```` block naming a declared tool is extracted and executed (`extractMarkdownJsonToolCalls`); a block naming a tool the speaker doesn't have is stripped and replaced with corrective text pointing at the tools it does have.
- **Option-selection carry-over**: a bare user reply of `1`/`2`/`A`/`B` resolves against the previous agent turn's numbered or lettered options and the selected option's text rides into generation and tool execution (`resolveSelectedOption`, `crew-selected-option.ts`).
- **Supervisor bookkeeping on every substantive round**: answer/action rounds run the supervisor in track-only mode — review, notes, plans, and blackboard/memory sync still persist; only the spoken directive is suppressed. Pure conversational rounds still skip it entirely. A failed review writes a durable `supervisor_notes` row with the error rather than vanishing.
- **Deterministic requirement capture**: user requirements are extracted from the user turn itself (`extractUserRequirement`) and deduplicated into `crew_sessions.memory.facts` — they do not depend on the supervisor model emitting them.
- **Firsthand ledger entries**: each successful tool call yields a `digest` (label list for JSON, first line for prose) and a `supported` `crew_claims` row with `sourceTurnId` provenance (`recordToolWorkClaims`). Claims are derived from executed work, never from agent prose. Agent-initiated ledger writes go through the approval-gated `propose_crew_claim`/`propose_crew_commitment`/`propose_crew_decision` tools — there is no ungated write path.

### Agent Identity
- **Legend + OCEAN traits**: each agent card carries a first-person operational philosophy, Big Five personality traits, and a soul archetype, reusing the platform Soul layer (`SoulService.generateSoulPrompt`). Profiles are deliberately polarised — a uniform 0.5 profile emits no steering and makes every agent sound identical.
- **Accumulated experience**: an agent recalls its own knowledge-graph entries for the subject under discussion, across repositories (`crew-memory.service.ts`).

### Agent Capabilities & Released Tool Permissions
- **Released Agent Tool Permissions**: Agents execute all tools explicitly declared on their `AgentCard.tools` (including write, execute, deploy, audit, and mutating tools) admitted as `reason: "declared-agent-tool"` without default-deny read-only blocking (`crew-tools.service.ts`).
- **Universal Asset & Capability Discovery**: All CREW agents have universal access to platform discovery tools (`discover_capabilities`, `list_installed_apps`, `list_pipelines`, `list_templates`, `list_pending_cycles`, `list_available_mcp_capabilities`, `list_calculation_nodes`).
- **Universal Working Memory & Swarm Delegation**: All agents have access to shared working memory (`update_blackboard`, `get_blackboard`) and multi-agent delegation via the Swarm marketplace (`request_help`, `request_mcp_tool`).
- **Tier 2 — Artifacts & Interactive Module Surfaces**: Agents render interactive micro-surfaces (e.g. `ScaffoldPackPod`, `PipelineBuilderPod`, `AgenticHRPod`, `HILGovernancePod`, `MissionBriefPod`, `DatasetSchemaPod`, instant apps) directly into chat turns via `InstantAppRenderer` and `FormRenderer`.
- **Tier 3.5 — Governed Proposal Tier & Inline Approvals**: Non-destructive drafts (`propose_mission`, `propose_cycle_draft`, `propose_research_mission`, `propose_mission_synthesis`) render as inline 1-click `<InlineApprovalCard />` components that inherit requester permissions (`@lead_operator`).
- **Live Creation Studio Container Reconciliation Handoff**: Approving a cycle draft mounts the `<ReconciliationProgressCard />` tracking live container reconciliation stages (`Postgres & Drizzle Schema Sync`, `App Scaffold Assembly`, `OpenTelemetry Probe`, `Health Check`) with a 1-click **`[Open Live App Surface]`** launch button upon completion.
- **Auditability**: Every tool call is recorded on the turn (`crew_turns.tools_used`), providing ground truth telemetry for Hermes W3C tracing.

### Flow Studio & Co-Creation Engine
CREW rooms support multi-agent pipeline and flow co-creation:
- **In-Chat Flow Proposals**: `propose_flow` produces an interactive `<FlowCreateProposalCard />` with pre-flight readiness score, P50/P95 latency & cost bounds, review perspective badges, and a 1-click "Inspect Canvas" action.
- **Interactive DAG Canvas & Rail Pod**: `<FlowStudioPod />` in the studio rail provides dual view modes (Visual DAG graph with typed port connectors vs. sequential list view).
- **Pre-Flight Verification & Simulation Debugger**: Integrated debugger (`⏮`, `▶`, `⏭`, `⟲`) simulates step execution, evaluating guard conditions (`TRUE`/`FALSE`) and inspecting mock data payloads.
- **Contextual Transformation Chips**: Selecting a step exposes quick-actions (`+ Fallback Branch`, `🛡️ Human Approval Gate`, `⚡ Add Guard Condition`, `Discuss in Chat`).
- **Multi-Agent Review Lenses**: Deliberates through 4 specialized persona lenses: **Security Sentinel** (auth boundaries & script safeguards), **FinOps** (inference token costs & batching), **SRE** (error resilience & retry policies), and **Domain Architecture**.
- **Operational Cycle Promotion**: 1-click promotion transforms drafted flows directly into Operational Cycle Blueprints.
- See full documentation in [CREW_FLOW_STUDIO.md](./features/CREW_FLOW_STUDIO.md).

### Learning Loop
- **Knowledge write-back**: settled conclusions are filed into each participating agent's knowledge graph, gated on consensus so contested claims are never persisted as fact (`crew-learning.service.ts`).
- **Issue raising**: low consensus plus a critique persists a `crew_issue` and publishes `CrossAppEventType.BLOCKER_CREATED`.
- **Intent capture**: the keyword classifier's guess is recorded against the intents the discussion actually revealed, giving a labelled corpus for measuring routing accuracy.

### Collaboration
- **Shareable rooms**: the room key lives in the URL, so a room can be linked.
- **Participants**: humans are invited by username and attributed by name on every turn (`crew_participants`, `crew_turns.user_id`). Display names resolve server-side from the session — a client-supplied name would be spoofable.
- **Live updates**: SSE per room over Redis pub/sub, with an in-process fallback for single-server deployments (`crew-stream.service.ts`).

### Project Space Scoping
Rooms belong to a Project Space, resolved by `withProjectScope()` so the existing read gate applies. Discussion-derived knowledge is filed under a project-qualified scope key and recall excludes other projects' entries — a conclusion reached in a private project cannot surface in another project's room.

### API Endpoints
```
POST /api/crew/message                     Run a round of discussion
GET  /api/crew/rooms                       Rooms the caller participates in
GET  /api/crew/:sessionKey                 Full room state
GET  /api/crew/:sessionKey/stream          SSE live updates
PUT  /api/crew/:sessionKey/members         Set the agent roster
POST /api/crew/:sessionKey/participants    Invite a person
```

### Schema
`crew_sessions`, `crew_members`, `crew_participants`, `crew_turns`, `supervisor_notes`, `crew_plans`, `crew_issues`, `crew_intent_observations`, `crew_hand_raises` (migrations 0014–0020).

### Composable Creation Studio & Adaptive Surface Protocol
An in-chat conversational and visual build engine that transforms user intent into fully assembled, topologically sorted, and governed operational artifacts (Workstreams, Cycles, Missions, Pipelines, Forged Apps).

- **Dynamic In-Chat Mermaid Flowcharts**: Renders live, reactive SVG workflow diagrams in the chat transcript with topological color-coding (`verified`, `active`, `ready`, `blocked`).
- **Adaptive Fulfillment Builder Pods**: 6 specialized micro-surfaces mounted in chat turns for progressive module-by-module configuration:
  1. `<ScaffoldPackPod />`: Host runtime, DB ORM, Auth, and UI design packs with conflict validation.
  2. `<PipelineBuilderPod />`: Sequential execution step sequencer with CEL condition gating.
  3. `<AgenticHRPod />`: Domain custodian roster, intelligence model tiers, and tool capability grants.
  4. `<HILGovernancePod />`: SOC2 multi-sig quorum rules, SLA timeout policies, and cryptographic attestation.
  5. `<MissionBriefPod />`: Measurable deliverables checklist, round limits, and exit criteria bounds.
  6. `<DatasetSchemaPod />`: Relational PostgreSQL Drizzle table builder with pgvector clustering.
- **Omnidirectional DAG Resolver & State Engine**: Topological sorting and prerequisite gating preventing out-of-order execution, tracking session progress ($0\% \rightarrow 100\%$).
- **Thread-Aware Supervisor**: Enforces stage gating (`on_track`, `redirect_needed`, `stage_ready`), actively redirecting agent debate if downstream stages are discussed prematurely.
- **Good Question Engine (GQE) & 6-Class Gap Linter**: Static DAG linter auditing governance gaps, unbound I/O, pack conflicts, capability deficits, dead-end branches, and observability gaps with 1-click in-chat remediation cards.
- **AST Assembly & X-Ray Deliverable**: Compiles Handlebars templates and atomic AST transformations, generating SHA-256 fingerprinted X-Ray Node Documentation and live Composition Graphs (`xray:cycle:<id>`).

#### Assembly Capability Tools
```
resolve_assembly_dag        Topologically sort blueprint stages and compute readiness
render_workflow_diagram     Synthesize in-chat reactive Mermaid flowcharts with state classes
mount_builder_pod           Mount specific adaptive fulfillment builder pod in chat
evaluate_functional_gaps    Run GQE 6-class static DAG lint and return entropy score
```

## Calculation Nodes Integration

A neuro-symbolic computation engine within the Oddjob Knowledge Graph, powering mathematical, probabilistic, machine learning, and temporal node calculations.

Domain: `server/domain/knowledge/core/calculations`. API Routes: `server/domain/knowledge/routes/calculations.route.ts`. Documentation: `docs/CALCULATION_NODES.md`.

### Operation Categories
- **Basic Math**: Arithmetic formulas with sandboxed evaluation, SUM, AVERAGE, MIN, MAX.
- **Temporal**: Moving Average, YoY, MoM, CAGR, Exponential Smoothing, Rolling Sum/Average.
- **Probabilistic**: Monte Carlo Simulation, Bayesian Inference, Confidence Intervals, Risk Assessment.
- **Constraint**: Rule Validation, Conditional Logic, Policy Enforcement, Gate Conditions.
- **Graph Algorithms**: PageRank, Centrality (Betweenness/Closeness), Shortest Path, Community Detection.
- **ML Inference**: Model Prediction, Classification, Regression Inference, Anomaly Detection, Ensembling.

### API Endpoints
```
POST   /api/calculations                  Create calculation node
GET    /api/calculations                  List calculation nodes
GET    /api/calculations/:id              Get calculation node by ID
PUT    /api/calculations/:id              Update calculation node
DELETE /api/calculations/:id              Delete calculation node
POST   /api/calculations/:id/execute      Execute calculation
GET    /api/calculations/:id/history      Execution history logs
GET    /api/calculations/:id/result       Get latest cached result
GET    /api/calculations/:id/dependencies List dependencies
POST   /api/calculations/:id/timeseries   Add time-series point
GET    /api/graph/centrality              Get graph node centrality scores
GET    /api/ml/models                     List registered ML models
```

---

## Formal Verification & Synthesis Control Plane

A neurosymbolic formal verification and mathematical synthesis engine providing sub-millisecond, compile-time QA guarantees across UI layouts, package dependencies, AI agent governance, and multi-agent mission schedulability.

Domain: `server/domain/scaffold/formal/`, `server/domain/governance/`, `server/domain/mission/formal/`.

### Core Capabilities
- **Continuous Layout SMT/QF_LRA Engine:** Proves UI geometric invariants (containment, non-overlap, ergonomic hitboxes) across continuous viewport spectrum $W \in [320\text{px}, 2560\text{px}]$, discovering exact counterexamples in $<1\text{ms}$.
- **MaxSMT Closed-Form CSS Synthesis:** Calculates optimal $L_1$ slack minimization to synthesize fluid `clamp(min, vw% + base, max)` and `@media` breakpoint thresholds directly into generated ASTs.
- **DPLL SAT Scaffold Pack Resolver:** Solves multi-pack dependency graphs with mutual exclusions and MaxSAT soft recommendation optimization.
- **Constrained Horn Clause (CHC) Governance Guard:** Formally model-checks agent toolchains to prove unprivileged agents cannot bypass Human-in-the-Loop (HIL) gates to mutate production.
- **WCAG 2.2 Relative Luminance Synthesis:** Calculates relative luminance and synthesizes guaranteed contrast-compliant Light & Dark palettes ($CR \ge 4.5:1$) from any brand seed hex.
- **Multi-Agent Mission Schedulability Prover:** Proves deadlock freedom on shared resource locks and token rate-limit compliance across continuous time using Critical Path Method (CPM).

### CLI & Testing
```bash
# Run all formal verification suites
npm run verify:formal

# Run live multi-domain demonstration
npx tsx scripts/demo-formal-verification.ts
npx tsx scripts/demo-complex-formal-scenarios.ts
```

---

## Agora Multi-Agent Deliberation Rooms

Transforms high-stakes Human-In-The-Loop (HIL) approvals into interactive, multi-agent debate rooms with strictly zero raw JSON presentation, structured briefings, and real-time collaborative synchronization.

Domains: `server/domain/crew/`, `server/domain/agora/`, `client/src/components/agent-chat/`.

### Core Capabilities
- **Zero Raw JSON Human-Readable Briefing:** [`AgoraDeliberationBriefing.tsx`](../client/src/components/agent-chat/AgoraDeliberationBriefing.tsx) provides plain-English summaries, Guardian/Optimizer/FinOps stances, and 1-click in-room action execution (`Authorize Execution` & `Reject with Directives`).
- **Real-Time SSE Proactive Push:** [`approval.service.ts`](../server/domain/integrations/core/approval.service.ts) emits `deliberation.started` events over `eventStream`, instantly surfacing a floating Agora Deliberation card in [`CopilotIntervention.tsx`](../server/domain/ai/ui/components/copilot/CopilotIntervention.tsx) across all open browser pages.
- **Auto-Seeded Multi-Agent Debate:** Automatically seeds initial opposing debate turns between Guardian and Optimizer in [`crew-orchestrator.service.ts`](../server/domain/crew/core/crew-orchestrator.service.ts).
- **Live WebSocket Collaborative Graph Sync:** [`agora.gateway.ts`](../server/domain/agora/gateways/agora.gateway.ts) and [`AgoraCanvas.tsx`](../server/domain/agora/ui/AgoraCanvas.tsx) synchronize real-time node edits and graph topology changes across all clients in the deliberation room.
- **In-Context HIL Bridge:** 1-click `[ ⚔️ Deliberate in Room ]` buttons embedded in [`ApprovalDetailDialog.tsx`](../server/domain/apps/ui/components/approvals/ApprovalDetailDialog.tsx) and [`DecisionInbox.tsx`](../server/domain/admin/ui/modules/admin/pages/DecisionInbox.tsx).

---

## Autonomous Agent PIP Self-Healing Loop

Autonomous closed-loop agent performance evaluation and remediation powered by database mission history and real-time tool error telemetry.

Domains: `server/domain/agents/core/`.

### Core Capabilities
- **Database Mission History Provider:** [`performance-evaluation-jobs.ts`](../server/domain/agents/core/performance-evaluation-jobs.ts) queries real `mission_runs`, `mission_agent_assignments`, and `agent_tool_usage` database tables.
- **Telemetry-Driven Auto-PIP Trigger:** [`tool-analytics.service.ts`](../server/domain/agents/core/tool-analytics.service.ts) monitors tool failure rates and automatically enrolls failing agents in Performance Improvement Plans (PIPs).
- **3-Tier Upskilling Remediation:**
  1. *Prompt Optimization:* Dynamically tunes system prompt instructions and constraints.
  2. *Golden Samples RAG:* Ingests high-performing few-shot exemplar vectors.
  3. *LoRA Fine-Tuning:* Schedules parameter-efficient fine-tuning jobs for chronic failure patterns.
- **Canary Benchmark Evaluation:** Automatically runs standardized benchmark tasks to verify remediation efficacy before graduating the agent back to production.

---

## Eulerian Hexagonal (Uber H3) Spatial Command Deck

Full operationalization of Oddjob's 5-Layer Eulerian H3 Spatial Analytics Engine into a dedicated top-level Command Deck at `/operations/spatial`.

Domains: `server/domain/ai/core/h3-hexagonal-spatial-engine.service.ts`, `client/src/modules/operations/pages/SpatialAnalyticsPage.tsx`.

### Core Capabilities
- **Eulerian H3 Tiling Studio:** Multi-resolution zoom (Res 5 to Res 10), centroid coordinate calculation, and $O(1)$ hierarchical bitwise parent rollups.
- **Isotropic Flux & Gaussian Kernel Decay:** Uniform 6-neighbor radial expansion ($\Phi = 0.0$ to $1.0$) with zero directional bias and concentric ring decay contours.
- **Spectral PCA Eigenvalues & Drift Vectors:** Real-time principal component decomposition ($\lambda_1, \lambda_2$) for spatial fleet movement and autonomous agent dispatch alignment.
- **Spatial Geofence & Predicate Rules:** Embedded [`H3SpatialPalette.tsx`](../client/src/components/signal-intelligence/spatial/H3SpatialPalette.tsx) for defining spatial boundaries, polygon geofences, and predicate triggers (`CONTAINS`, `INTERSECTS`, `WITHIN_DISTANCE`).

### API Endpoints
```
POST /api/prediction/spatial/evaluate    Evaluate H3 cell state, Gaussian kernel decay, & spatial surprise
POST /api/prediction/spatial/eigenvalues Compute spectral PCA eigenvalues and spatial drift direction
```

---

## Unified App Lifecycle: Forge → Builder Studio → Direct Publish

A continuous delivery paradigm that turns **App Builder Studio** into the permanent end-state of the App Forge generation process and provides **Direct Top-Bar Publishing** with enterprise access governance.

### Core Capabilities
- **Forge Ignition Handshake**: Replaces static completion dialogs with an animated Ignition Banner featuring a 3-second auto-redirect countdown to `/armory/apps/:id?tab=preview`, maintaining creative flow from scaffolding directly into layout refinement.
- **4-Zone Targeted Grid Placement**: Drag-and-drop primitives from the component catalog into explicit spatial slots (`Top`, `Left Column`, `Right Column`, `Bottom`) with magnetic border illumination and explicit layout prompts.
- **AI Edit Payload Normalization**: Automatically unwraps nested JSON object maps, array file lists, and `{ code }`/`{ content }` keys into flat, valid string file maps before validation.
- **Top-Bar Direct Publish Action**: A glowing `[🚀 Publish App]` action and status beacon (`● PUBLISHED` vs `○ DRAFT`) right in the Builder header toolbar next to the container port beacon.
- **In-Studio Go-Live Modal**: Allows instant configuration of public route slugs (`/forged/:slug`), access governance (`Public`, `Organization Only`, `Password Guarded`), and semantic version tags (`v1.0.0`) without leaving the active canvas.
- **Adaptive Canvas for Headless APIs**: Renders an interactive OpenAPI 3.1 specification, cURL command generator, and live request runner for microservices and non-visual backends.
- **Shareable Distribution Assets**: Generates live canonical production URLs and intranet embed codes (`<iframe src="..." />`) on deployment.

### API Endpoints
```
POST /api/apps/:id/deploy             Deploy or update app deployment with slug, access policy, and versioning
GET  /api/apps/:id/deploy             Retrieve active deployment configuration and public URL
GET  /api/apps/:id/readiness?probe=1   Verify AST cleanliness and container readiness
POST /api/apps/:id/start              Instantiate and boot container runtime
```

---

## Balanced 3-Column CREW Workspace & Unified Agentic App Forge

A unified, multi-column agentic workspace architecture that bridges Armory generation into live collaborative CREW rooms, eliminating header obscuration and establishing side-by-side agent deliberation, application synthesis, and execution telemetry.

Domains: `client/src/components/agent-chat/`, `client/src/modules/apps/`, `server/domain/crew/`.

### Core Capabilities
- **Balanced 3-Column Cockpit**:
  - *Column 1 (Left)*: Agent Chat Transcript & Interactive Composer with Copilot, Architect, and squad deliberation.
  - *Column 2 (Center)*: [`AppStudioPod.tsx`](../client/src/modules/apps/AppStudioPod.tsx) featuring the 6 Architecture Archetypes, 3-Phase Guided Walkthrough (Archetype Selection → Specs & Requirements → Pre-Flight Review & Ignition), real-time SSE event stream logs, and in-place Builder promotion.
  - *Column 3 (Right)*: [`CyclePipelineRightRail.tsx`](../client/src/components/agent-chat/rails/CyclePipelineRightRail.tsx) featuring the 4-stage Workflow Progression (Cycle DAG), Modular Assembly Stack checklist (`UI / View Component`, `Pipeline / Logic DAG`, `Dataset Schema`, `Project Scope`), and collapsible mini-spine toggle (`w-12`).
- **Clean Header Surface**: Automatically suppresses horizontal breadcrumbs when studio pods are active, moving pipeline progress exclusively to the dedicated right rail without clipping or visual overlap.
- **Unified Armory Integration**: Replaces legacy standalone Armory forms (`/armory/forge`) with direct navigation to the CREW Agentic Studio (`/workspace/chat?studio=forge`).
- **Cross-SPA Navigation & Auto-Mounting**: Automatically preserves URL search parameters across internal room rewrites, auto-mounting the App Forge Studio Pod in Forge mode on arrival.
- **Collapsible Mini-Spine Focus**: 1-click collapse/expand toggles for both the left Chat panel (Focus Studio) and the right Cycle Pipeline rail, enabling authors to transition effortlessly between multi-column collaboration and full-canvas visual assembly.

---

## S.C.O.R.E. Governed Walkthroughs, Live Demos & Self-Maintaining Architecture

A comprehensive, on-screen interactive guidance and onboarding engine structured across the 5 **S.C.O.R.E.** governance dimensions (**S**cope, **C**ontinuity, **O**utcome, **R**eliability, **E**ulerian). Built to educate operators and developers without cognitive overload while guaranteeing zero DOM selector drift via static CI verification gates.

Domains: `client/src/lib/tutorial-engine.ts`, `client/src/components/ui/TutorialHost.tsx`, `client/src/components/ui/TutorialBubble.tsx`, `server/domain/core/ui/components/shared/CommandPalette.tsx`, `server/domain/knowledge/ui/modules/knowledge/pages/ComponentStyleGallery.tsx`, `server/domain/tools/v1/capabilities/discovery.ts`.

### Core Capabilities
- **5 S.C.O.R.E. Governance Dimensions**:
  - **Scope**: Boundary verification, mission bounds, and budget cap constraints (`[data-tour="scope-workstream"]`).
  - **Continuity**: Checkpoints, state persistence, rollback safety, and resume semantics (`[data-tour="continuity-timeline"]`).
  - **Outcome**: Closed-loop outcome calibration and verifiable telemetry scoring >= 9.5 (`[data-tour="outcome-calibration"]`).
  - **Reliability**: Circuit breakers, self-healing rescue strategies, and safety gates (`[data-tour="reliability-guard"]`).
  - **Eulerian**: Uber H3 hexagonal spatial analytics and real-time telemetry streaming (`[data-tour="eulerian-telemetry"]`).
- **Canonical Chained Playlists (`TUTORIAL_CHAINS`)**:
  - `chain:executive-overview`: Executive platform briefing covering all 5 governance pillars.
  - `chain:developer-forge`: App Forge blueprint assembly and visual code synthesis.
  - `chain:spatial-operator`: Eulerian H3 spatial fleet analytics and signal intelligence.
  - `chain:operator-flight-deck`: Real-time mission flight deck and cycle simulations.
  - `chain:enterprise-architect`: Formal layout proofs and governance gates.
  - `chain:builder-pod-mastery`: In-chat adaptive builder pods and instant app generation.
  - `chain:full-platform-immersion`: Complete end-to-end platform immersion tour.
- **Rich Interactive Spotlight Bubbles**:
  - Floating spotlight tooltips with auto-flipping, boundary clamping, and zero layout shift.
  - Interactive `<kbd>` keyboard accelerator badges (`⌘K`, `⌘J`).
  - Actionable pro-tip hint callout boxes with amber visual accents.
  - Footer deep-links to technical documentation (`📖 Specs`) and the Component Style Gallery (`🎨 Gallery`).
- **Frictionless URL Auto-Launcher**:
  - Deep-linkable tours via `?tutorial=<id>` (e.g. `http://localhost:5000/launchpad?tutorial=chain:developer-forge`).
  - Automatically mounts on page load and scrubs query parameters cleanly using `history.replaceState`.
- **Command Palette Integration (`⌘K`)**:
  - Dedicated `<CommandGroup heading="Guided Walkthroughs & Demos">` prominently positioned above Quick Actions.
- **Component Style Gallery Live Demos**:
  - Real-time matching between indexed components and tutorial snippets.
  - Cards feature an interactive **"Live Demo" badge** and a **"▶ Live Demo" button** that immediately triggers the tour.
- **Copilot Agentic Integration**:
  - Dedicated `launch_score_tutorial({ trackId, reason })` tool capability with `idempotency: "read-safe"`.
  - Rich chat card rendering with one-click **"Start Walkthrough"** action.
- **CI Drift Prevention Gate (`npm run test:drift`)**:
  - Sub-1.5s automated verification asserting 100% target file existence, `@behavior` test ID presence, non-empty DOM selectors, and playlist chain integrity.

### API & Tool Endpoints
```
TOOL launch_score_tutorial     Launch an interactive, step-by-step UI walkthrough or tutorial track on screen
POST /api/component-index/sync Index UI components and enrich with matching tutorial linkages
GET  /launchpad?tutorial=:id   Auto-mount and launch guided walkthrough on target route
```

---

## Governed AI Film Production & ComfyUI Media Studio

A multi-scene, generative cinematic production environment that bridges screenplays from **Scribe Studio** into multi-shot AI video synthesis, continuity governance, ComfyUI node graphs, Human-in-the-Loop (HIL) Dailies review, and timeline reel assembly.

Domains: `client/src/modules/media/`, `server/domain/media-studio/`, `server/domain/core/ui/components/packaged/MediaStudioPod.tsx`, `server/domain/core/ui/components/packaged/MediaConfigPod.tsx`, `shared/media-adapter-nodes.ts`, `shared/scribe-to-media.ts`.

### Core Capabilities
- **5 Custom ComfyUI Adapter Nodes**:
  - `OddjobScribeScriptAdapter` (Layer 0): Ingests screenplay scenes, sluglines, dialogue, and camera directions directly from Scribe Studio.
  - `OddjobCharacterContinuityNode` (Layer 1): Enforces character face seeds, wardrobe consistency, and environment reference latents.
  - `OddjobVideoGenSeedance` (Layer 2): Compiles checkpoint models, camera motions, aspect ratios, and duration vectors for Seedance generation.
  - `OddjobHILDailiesReviewGate` (Layer 3): Enforces human director approval gates before takes are promoted or assembled.
  - `OddjobDatasetCatalogSink` (Layer 4): Indexes approved takes with semantic embeddings directly into the `media_takes_catalog`.
- **Deterministic Workflow Compiler (`computeWorkflowFingerprint`)**:
  - Canonical JSON serialization with SHA-256 topological hashing, preventing redundant re-renders and enabling instant incremental caching.
- **Scribe-Style Studio Header & Focus Mode**:
  - High-contrast, theme-tokenized **Exit** and **Focus Studio / Show Chat** controls for frictionless transitions between multi-column agent chat and full-canvas visual directing.
- **Assembler**:
  - Directly exposes the active 5-layer video assembly stack in the right rail, supporting interactive collapse (`32px`) and expansion (`320px`).
- **Interactive Dailies Inspector**:
  - Integrated `PlatformImageComparisonBlock` for real-time A/B split-wipe comparison between video takes, candidate seeds, and prompt iterations.
- **Automated FFmpeg Scene Assembly**:
  - Background timeline cutter (`assemble_scene_timeline`) that stiches approved takes, transitions, and audio tracks into a cohesive scene reel.

### API & Tool Endpoints
```
TOOL mount_media_studio       Open Media Studio beside CREW chat on a film production
TOOL assemble_scene_timeline  Assemble approved takes into a cohesive scene reel with transitions
TOOL seedance_submit_shot     Dispatch shot generation to Seedance 2.0 with continuity seeds
TOOL seedance_check_status    Poll take generation progress, status, and video URLs
TOOL seedance_estimate_cost   Pre-flight budget ceiling cost estimation
TOOL render_dailies_deck      Generate Dailies review summary cards in chat
TOOL propose_media_change     Draft surgical scene changes without destructive overwriting
TOOL apply_media_change       Commit approved scene changes with optimistic digest verification
```

---

## Computer Use, Human Takeover & Learned Skills

Agents operate a real desktop per organization (screenshots, clicks, typing, browsing), people can take over through a login-protected viewer, and what a person does in the browser can become a reviewed, reusable skill. Full guide: `server/knowledge/features/computer-use.md` (also in the in-app Documentation section as **Computer Use**).

### Features
- **Per-organization desktops**: `oddjob/cua-desktop` containers (Cua XFCE plus a recordable Chromium), created on first use, stopped when idle, logins persisted.
- **Gemini computer use**: `gemini-3.8-flash` over the Gemini Interactions API plans each action from screenshots; pauses on safety prompts, `yield_to_user` hand-overs, or (supervised mode) before every action.
- **Login-protected viewer**: noVNC behind login, org membership and a one-use ticket; **Open desktop** on the Computer Use settings card and the Operations session viewer.
- **Learned skills**: a takeover (or a manual recording) is captured as page-level steps, drafted by Gemini into inputs, secret slots and a procedure, approved by an admin, then matched and replayed for new tasks, with the agent finishing the rest.

### Usage
```
TRYCUA_PROVIDER=cua
TRYCUA_PROVIDER_TYPE=org_desktop
```
Enable **Computer Use** for the organization (Admin → Settings), then run a task: `POST /api/integrations/trycua/computer-use/tasks { sessionId, task }`, or from an agent with `trycua_run_task`.

### Agent Tools
```
TOOL trycua_run_task          Goal in plain language; replays a matching skill, then Gemini finishes
TOOL trycua_list_skills       List the organization's approved learned skills
TOOL trycua_create_session    Session on the organization's desktop (plus low-level trycua_* actions)
```
