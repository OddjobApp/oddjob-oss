/**
 * Tutorial registry: the snippets, chains and tutorials themselves.
 *
 * This is shared rather than client-side because the server reads it too --
 * searchComponentIndex links indexed components to the snippets that walk a
 * user through them. It previously lived in client/src and the server reached
 * across into it, which resolved but pointed the dependency arrow backwards.
 *
 * Everything here is pure data and pure functions. The parts that touch the
 * DOM -- startTutorial, startTutorialChain, emitTutorialOutcome -- stay in
 * client/src/lib/tutorial-engine.ts, which re-exports this module so existing
 * client imports keep working unchanged.
 */

/** S.C.O.R.E. dimension a step or snippet exercises. */
export type ScoreDimension = "S" | "C" | "O" | "R" | "E";

export interface TutorialStep {
  target: string;
  title: string;
  description: string;
  /** What action it performs if any (e.g. click action, navigation, toggle, form submit) */
  action?: string;
  scoreDimension: ScoreDimension;
  side?: "top" | "bottom" | "left" | "right";
  nextLabel?: string;
  /** Chaining & Module Metadata */
  moduleTitle?: string;
  moduleIndex?: number;
  totalModules?: number;
  targetRoute?: string;
  /** Hints & Deep-Links */
  shortcut?: string;
  hint?: string;
  docSlug?: string;
  componentId?: string;
}

export interface TutorialDefinition {
  id: string;
  name: string;
  category?: string;
  targetRoute?: string;
  intervalMs?: number;
  steps: TutorialStep[];
}

/** An atomic, reusable building-block snippet */
export interface TutorialSnippet {
  id: string;
  title: string;
  category: "discovery" | "telemetry" | "copilot" | "governance" | "forge" | "cycles" | "spatial" | "projects" | "builder-pods" | "knowledge" | "media";
  targetRoute?: string;
  scoreDimension: ScoreDimension;
  steps: TutorialStep[];

  /** Architectural & Governance Linkages */
  componentId?: string;
  sourceFile?: string;
  behaviorId?: string;
  docSlug?: string;

  /** Hints & Accelerators */
  shortcut?: string;
  hint?: string;
  /** Primary action performed by this snippet target */
  action?: string;
}

/** A sequence of tutorial snippets chained together as an instructive playlist */
export interface TutorialChain {
  id: string;
  name: string;
  description?: string;
  autoNavigate?: boolean;
  intervalMs?: number;
  snippetIds: string[];
}

/** Atomic S.C.O.R.E. Snippet Library */
export const TUTORIAL_SNIPPETS: Record<string, TutorialSnippet> = {
  "snippet:discovery": {
    id: "snippet:discovery",
    title: "Omnipresent Discovery",
    category: "discovery",
    scoreDimension: "S",
    componentId: "command-palette",
    sourceFile: "server/domain/core/ui/components/shared/CommandPalette.tsx",
    behaviorId: "ui.navigation.command-palette",
    docSlug: "features/command-palette",
    shortcut: "⌘K",
    hint: "Press ⌘K or Ctrl+K from anywhere in Oddjob to launch the universal search palette.",
    action: "Press ⌘K or click to open the global command palette and search apps, blueprints, or cycle commands.",
    steps: [
      {
        scoreDimension: "S",
        target: "input[placeholder*='Search'], [title='Open command palette'], [data-testid='universal-search-trigger'], button:has(.lucide-search)",
        side: "bottom",
        title: "Omnipresent Discovery (Cmd+K)",
        description: "Universal search and quick navigation palette for finding apps, canonical blueprints, or cycle commands.",
        action: "Press ⌘K or click to open the global command palette and search resources.",
        shortcut: "⌘K",
        hint: "Press ⌘K or Ctrl+K from anywhere in Oddjob to launch the universal search palette.",
      },
    ],
  },
  "snippet:telemetry": {
    id: "snippet:telemetry",
    title: "Eulerian Telemetry & Budget Tracker",
    category: "telemetry",
    scoreDimension: "C",
    componentId: "header-mission-ticker",
    sourceFile: "server/domain/core/ui/components/layout/Header.tsx",
    behaviorId: "telemetry.eulerian.mission-ticker",
    docSlug: "feature-documentation/spatial-telemetry-engine.md",
    hint: "Click the mission ticker to inspect live spend vs budget caps and active worker concurrency.",
    action: "Click to open the telemetry drawer and inspect real-time burn rates and active worker concurrency.",
    steps: [
      {
        scoreDimension: "C",
        target: "[data-testid='header-mission-ticker'], [data-testid='header-mission-ticker-spend'], #header-mission-ticker",
        side: "bottom",
        title: "Live Eulerian Mission Telemetry",
        description: "Streams active mission status, spend vs budget caps, and live worker execution state without page reloads.",
        action: "Click to open the telemetry drawer and inspect real-time burn rates and active worker concurrency.",
        hint: "Click the mission ticker to inspect live spend vs budget caps and active worker concurrency.",
      },
    ],
  },
  "snippet:copilot": {
    id: "snippet:copilot",
    title: "Autonomous Co-pilot Assistant",
    category: "copilot",
    scoreDimension: "R",
    componentId: "agent-chat-sheet",
    sourceFile: "server/domain/core/ui/components/layout/AgentChatSheet.tsx",
    behaviorId: "ai.copilot.chat-sheet",
    docSlug: "features/autonomous-copilot",
    shortcut: "⌘J",
    hint: "Type plain English requests like 'Explain this route breach' or 'Scaffold a rescue dispatch app'.",
    action: "Press ⌘J or click to slide out the co-pilot chat drawer and prompt your agent crew.",
    steps: [
      {
        scoreDimension: "R",
        target: "button:has(.lucide-sparkles), [title*='Oddjob Assistant']",
        side: "bottom",
        title: "Autonomous Co-pilot Assistant",
        description: "Embedded AI co-pilot for system orchestration, AST analysis, and automated workflows.",
        action: "Press ⌘J or click to slide out the co-pilot chat drawer and prompt your agent crew.",
        shortcut: "⌘J",
        hint: "Type plain English requests like 'Explain this route breach' or 'Scaffold a rescue dispatch app'.",
      },
    ],
  },
  "snippet:governance": {
    id: "snippet:governance",
    title: "Multi-Tenant Context & Safety",
    category: "governance",
    scoreDimension: "O",
    componentId: "org-selector",
    sourceFile: "server/domain/core/ui/components/layout/Header.tsx",
    behaviorId: "auth.tenant.isolation",
    docSlug: "architecture/tenant-isolation",
    hint: "Switching the active organization updates telemetry isolation and cryptographic audit boundaries instantly.",
    action: "Click to switch active organization tenant, isolation boundaries, and cryptographic audit contexts.",
    steps: [
      {
        scoreDimension: "O",
        target: "button:has(.lucide-building-2), [data-testid='org-selector'], .h-10.w-10.rounded-2xl.bg-gradient-to-br, [title='Open account actions']",
        side: "bottom",
        title: "Multi-Tenant Context & Safety",
        description: "All pipeline runs, datasets, and agent actions are securely isolated to your active organization context.",
        action: "Click to switch active organization tenant, isolation boundaries, and cryptographic audit contexts.",
        nextLabel: "Complete Overview",
        hint: "Switching the active organization updates telemetry isolation and cryptographic audit boundaries instantly.",
      },
    ],
  },
  "snippet:app-forge": {
    id: "snippet:app-forge",
    title: "34 Canonical App Blueprints",
    category: "forge",
    targetRoute: "/launchpad",
    scoreDimension: "S",
    componentId: "command-launchpad-page",
    sourceFile: "server/domain/apps/ui/modules/apps/pages/CommandLaunchpadPage.tsx",
    behaviorId: "forge.blueprint.catalog",
    docSlug: "feature-documentation/component-gallery-synthesis.md",
    hint: "Type keywords like 'spatial', 'telemetry', or 'rescue' to filter canonical blueprints.",
    steps: [
      {
        scoreDimension: "S",
        target: "input[placeholder*='Search'], [data-testid='forge-blueprint-card'], [data-testid='blueprint-selector'], .border.rounded-xl, header",
        side: "bottom",
        title: "App Forge Catalog",
        description: "Access 34 production-verified enterprise blueprints with automated SMT verification and instant scaffolding.",
        hint: "Type keywords like 'spatial', 'telemetry', or 'rescue' to filter canonical blueprints.",
      },
    ],
  },
  "snippet:cycle-builder": {
    id: "snippet:cycle-builder",
    title: "Visual Flow Studio & Simulation",
    category: "cycles",
    targetRoute: "/operations/cycles/312",
    scoreDimension: "R",
    componentId: "cycle-detail-page",
    sourceFile: "client/src/modules/operations/pages/CycleDetailPage.tsx",
    behaviorId: "operations.cycle.visual-flow",
    docSlug: "workflows/ADDING_A_NEW_ROUTE.md",
    hint: "Click 'Simulate' to execute a topological depth dry-run without altering live state.",
    steps: [
      {
        scoreDimension: "R",
        target: "button:has-text('Simulate'), [data-testid='simulate-cycle-btn'], [data-testid='canvas-container'], header",
        side: "bottom",
        title: "Visual Flow Studio & Live Dry-Run",
        description: "Assemble multi-phase agent workflows with topological depth simulation before touching live production systems.",
        hint: "Click 'Simulate' to execute a topological depth dry-run without altering live state.",
      },
    ],
  },
  "snippet:spatial-intelligence": {
    id: "snippet:spatial-intelligence",
    title: "Eulerian Hexagonal Spatial Intelligence",
    category: "spatial",
    targetRoute: "/spatial",
    scoreDimension: "C",
    componentId: "signal-dashboard-page",
    sourceFile: "client/src/components/signal-intelligence/SignalDashboard.tsx",
    behaviorId: "spatial.hexagonal.h3-analytics",
    docSlug: "feature-documentation/spatial-telemetry-engine.md",
    hint: "Scroll to zoom into Uber H3 hexagonal resolution level 9 for building-level incident telemetry.",
    steps: [
      {
        scoreDimension: "C",
        target: "[data-testid='spatial-viewport'], canvas, [data-testid='map-container'], header",
        side: "bottom",
        title: "Real-Time Eulerian H3 Spatial Grid",
        description: "Uber H3 hexagonal analytics visualize live agent swarm density, field asset locations, and regional telemetry at sub-second intervals.",
        hint: "Scroll to zoom into Uber H3 hexagonal resolution level 9 for building-level incident telemetry.",
      },
    ],
  },
  "snippet:project-spaces": {
    id: "snippet:project-spaces",
    title: "Project Spaces & Durable Scopes",
    category: "projects",
    targetRoute: "/projects",
    scoreDimension: "S",
    componentId: "projects-dashboard-page",
    sourceFile: "client/src/modules/projects/pages/ProjectsDashboard.tsx",
    behaviorId: "projects.workspace.governance",
    docSlug: "features/project-spaces",
    steps: [
      {
        scoreDimension: "S",
        target: "[data-testid='projects-grid'], [data-testid='new-project-btn'], .grid, header",
        side: "bottom",
        title: "Durable Project Governance",
        description: "Organize autonomous agent operations into durable project spaces that bind together missions, pipelines, datasets, and knowledge.",
      },
    ],
  },
  "snippet:builder-pods": {
    id: "snippet:builder-pods",
    title: "Governed AI Builder Pods",
    category: "builder-pods",
    targetRoute: "/dev/builder-pods",
    scoreDimension: "R",
    componentId: "builder-pods-showcase-page",
    sourceFile: "client/src/pages/dev/BuilderPodsShowcasePage.tsx",
    behaviorId: "forge.sandbox.builder-pods",
    docSlug: "features/builder-pods",
    steps: [
      {
        scoreDimension: "R",
        target: "[data-testid='builder-pod-card'], .builder-pod, .border.rounded-xl, header",
        side: "bottom",
        title: "Pre-Flight Builder Pod Sandbox",
        description: "Mount specialized, isolated builder pods with pre-validated assembly tools, SMT formal verification, and deterministic outputs.",
      },
    ],
  },
  "snippet:hil-gates": {
    id: "snippet:hil-gates",
    title: "Human-In-The-Loop Safety Gates",
    category: "governance",
    targetRoute: "/external/task",
    scoreDimension: "O",
    componentId: "external-task-page",
    sourceFile: "server/domain/core/ui/pages/ExternalTaskPage.tsx",
    behaviorId: "governance.hil.cryptographic-signoff",
    docSlug: "workflows/ADDING_A_NEW_HIL_FORM.md",
    steps: [
      {
        scoreDimension: "O",
        target: "[data-testid='hil-form-container'], form, [data-testid='submit-hil-btn'], header",
        side: "bottom",
        title: "Cryptographic HIL Sign-off",
        description: "Sensitive agent operations require cryptographic human approvals with token soft-caps and forensic audit trails.",
      },
    ],
  },
  "snippet:knowledge-graph": {
    id: "snippet:knowledge-graph",
    title: "Knowledge Garden & Semantic Enrichment",
    category: "knowledge",
    targetRoute: "/dashboard",
    scoreDimension: "C",
    componentId: "knowledge-garden-page",
    sourceFile: "server/domain/knowledge/ui/modules/knowledge/pages/KnowledgeGarden.tsx",
    behaviorId: "knowledge.semantic.entity-graph",
    docSlug: "workflows/knowledge_engine_2.md",
    steps: [
      {
        scoreDimension: "C",
        target: "[data-testid='knowledge-search'], [data-testid='knowledge-graph-container'], [title*='Knowledge'], header",
        side: "bottom",
        title: "Contextual Grounding & Entity Graphs",
        description: "Ground agent reasoning in verified enterprise entity graphs, structured document corpora, and curated datasets.",
      },
    ],
  },
  "snippet:crew-roster": {
    id: "snippet:crew-roster",
    title: "Autonomous Agent Crew Roster",
    category: "copilot",
    targetRoute: "/workspace/chat/crew-film-studio-alpha",
    scoreDimension: "R",
    componentId: "crew-roster",
    sourceFile: "client/src/components/agent-chat/CrewRoster.tsx",
    behaviorId: "ai.crew.agent-roster",
    docSlug: "features/autonomous-copilot",
    hint: "Click any agent card to toggle participation in the collaborative room deliberation.",
    action: "Click any agent card to recruit or mute their participation in room deliberations.",
    steps: [
      {
        scoreDimension: "R",
        target: "[data-testid='crew-roster-container'], [data-testid='crew-roster']",
        side: "bottom",
        title: "Autonomous Agent Crew Roster",
        description: "Active squad members and frontier AI agents available for operational deliberation, tactical execution, and automated governance.",
        action: "Click any agent card to recruit or mute their participation in room deliberations.",
        hint: "Click any agent card to toggle participation in the collaborative room deliberation.",
      },
    ],
  },
  "snippet:film-studio": {
    id: "snippet:film-studio",
    title: "AI Film Production Studio",
    category: "media",
    targetRoute: "/launchpad",
    scoreDimension: "S",
    componentId: "film-studio-showcase-card",
    sourceFile: "server/domain/apps/ui/modules/apps/pages/CommandLaunchpadPage.tsx",
    behaviorId: "media.film.studio-orchestration",
    docSlug: "workflows/selenium_job_implementation.md",
    hint: "Click to start the autonomous multi-scene film production walkthrough with 8s pacing.",
    action: "Click to launch the 8s interactive tour across Scribe scripts, Seedance video, and conformed reel.",
    steps: [
      {
        scoreDimension: "S",
        target: "[data-tutorial='film-studio-card'], [data-tutorial='film-studio-tour-trigger'], [data-testid='film-studio-card'], header",
        side: "bottom",
        title: "AI Film Production Studio (Project Chimera)",
        description: "Autonomous multi-agent cinematic production crew (Creative Director, Visual Artist, Technical Director, Producer) orchestrating Scribe scripts, Seedance video generation, and conformed timeline delivery.",
        hint: "Step advances automatically every 8 seconds, or you can click Next at any time.",
      },
    ],
  },
  "snippet:film-storyboard": {
    id: "snippet:film-storyboard",
    title: "Visual Storyboard & Keyframes",
    category: "media",
    targetRoute: "/workspace/chat/crew-film-studio-alpha",
    scoreDimension: "C",
    componentId: "media-studio",
    sourceFile: "client/src/modules/media/MediaStudio.tsx",
    behaviorId: "media.film.storyboard-pitch",
    docSlug: "workflows/selenium_job_implementation.md",
    hint: "Inspect visual keyframe pitches, scene framing, and narrative beat generation.",
    action: "Click the Storyboard tab to review generated keyframe visual pitches and style anchors.",
    steps: [
      {
        scoreDimension: "C",
        target: "#media-tab-storyboard, [data-testid='media-panel-storyboard'], [role='tablist']",
        side: "bottom",
        title: "Visual Storyboard & Keyframe Pitches",
        description: "The Visual Artist generates scene keyframes, composition cues, and style anchors aligned with the narrative arc.",
        action: "Click the Storyboard tab to inspect keyframe prompts and visual continuity.",
        hint: "Inspect visual keyframe pitches, scene framing, and narrative beat generation.",
      },
    ],
  },
  "snippet:film-shots-dailies": {
    id: "snippet:film-shots-dailies",
    title: "Video Shots & HIL Dailies",
    category: "media",
    targetRoute: "/workspace/chat/crew-film-studio-alpha",
    scoreDimension: "O",
    componentId: "media-studio",
    sourceFile: "client/src/modules/media/MediaStudio.tsx",
    behaviorId: "media.film.shots-dailies",
    docSlug: "workflows/selenium_job_implementation.md",
    hint: "Review multi-take video generations and human-in-the-loop dailies approval gates.",
    action: "Click the Shots tab to review Seedance video takes and approve candidates for final assembly.",
    steps: [
      {
        scoreDimension: "O",
        target: "#media-tab-shots, [data-testid='media-panel-shots'], [role='tablist']",
        side: "bottom",
        title: "Seedance Video Shots & HIL Dailies",
        description: "Autonomous agents orchestrate multi-take video generation. Production supervisors conduct dailies reviews to approve takes or request prompt revisions.",
        action: "Click the Shots tab to review Seedance video takes and approve candidates for final assembly.",
        hint: "Review multi-take video generations and human-in-the-loop dailies approval gates.",
      },
    ],
  },
  "snippet:film-conformed-timeline": {
    id: "snippet:film-conformed-timeline",
    title: "Conformed Reel & Assembly",
    category: "media",
    targetRoute: "/workspace/chat/crew-film-studio-alpha",
    scoreDimension: "E",
    componentId: "media-studio",
    sourceFile: "client/src/modules/media/MediaStudio.tsx",
    behaviorId: "media.film.conformed-timeline",
    docSlug: "workflows/selenium_job_implementation.md",
    hint: "Play back the assembled multi-shot conformed reel with synchronized audio and transitions.",
    action: "Click the Film tab to preview the master conformed timeline and export the deliverable.",
    steps: [
      {
        scoreDimension: "E",
        target: "#media-tab-film, [data-testid='media-panel-film'], [role='tablist']",
        side: "bottom",
        title: "Conformed Timeline & Final Assembly",
        description: "The Technical Director stitches approved takes into an assembled, conformed timeline reel ready for executive sign-off and distribution.",
        action: "Click the Film tab to preview the master conformed timeline and export the deliverable.",
        hint: "Play back the assembled multi-shot conformed reel with synchronized audio and transitions.",
      },
    ],
  },
  "snippet:rescue-launchpad": {
    id: "snippet:rescue-launchpad",
    title: "Emergency Rescue & Dispatcher",
    category: "cycles",
    targetRoute: "/launchpad",
    scoreDimension: "S",
    componentId: "rescue-launchpad-card",
    sourceFile: "server/domain/apps/ui/modules/apps/pages/CommandLaunchpadPage.tsx",
    behaviorId: "rescue.dispatch.launchpad-briefing",
    docSlug: "docs/specs/rescue-dispatch-functional-spec.md",
    hint: "Click to launch the autonomous emergency rescue and dispatch walkthrough with live telemetry.",
    action: "Click to launch the 8s interactive tour across spatial anomaly detection, war room triage, and structured data intake.",
    steps: [
      {
        scoreDimension: "S",
        target: "[data-tutorial='rescue-dispatch-card'], [data-tutorial='rescue-dispatch-tour-trigger'], [data-testid='rescue-dispatch-card'], header",
        side: "bottom",
        title: "Emergency Rescue & Service Dispatcher (Apex Response)",
        description: "Critical telemetry anomaly detected in Sector 7. Multi-agent emergency coordinator, spatial anomaly indexing, and rapid triage pipelines are primed for deployment.",
        hint: "Step advances automatically every 8 seconds, or you can click Next at any time.",
      },
    ],
  },
  "snippet:rescue-spatial": {
    id: "snippet:rescue-spatial",
    title: "H3 Hex Anomaly & Telemetry",
    category: "spatial",
    targetRoute: "/spatial?lat=34.0522&lng=-118.2437&query=Los+Angeles,+CA",
    scoreDimension: "C",
    componentId: "spatial-signal-dashboard",
    sourceFile: "client/src/components/signal-intelligence/SignalDashboard.tsx",
    behaviorId: "spatial.hexagonal.anomaly-detection",
    docSlug: "docs/specs/rescue-dispatch-functional-spec.md",
    hint: "Uber H3 hexagonal indexing isolates critical anomalies to sub-second localized blast radius.",
    action: "Inspect the spatial telemetry stream and localized causal impact radius.",
    steps: [
      {
        scoreDimension: "C",
        target: "[data-testid='spatial-viewport'], canvas, [data-testid='signal-feed-panel'], header",
        side: "bottom",
        title: "H3 Hex Anomaly & Spatial Telemetry",
        description: "Eulerian H3 spatial analytics isolate the telemetry breach to hex cluster 8828308281fffff. Commercial Generator #4 (GEN-8842-X) reports critical temperature threshold exceedance at Site 4 Power Station (200 N Spring St, Los Angeles, CA).",
        action: "Inspect the spatial telemetry stream and localized causal impact radius.",
        hint: "H3 hexagonal resolution 9 provides building-level asset telemetry tracking in Los Angeles, CA.",
      },
    ],
  },
  "snippet:rescue-geo-rule": {
    id: "snippet:rescue-geo-rule",
    title: "H3 Geo Event & Predicate Rules",
    category: "governance",
    targetRoute: "/spatial?tab=rules&lat=34.0522&lng=-118.2437",
    scoreDimension: "C",
    componentId: "rule-builder",
    sourceFile: "client/src/components/signal-intelligence/spatial/RuleBuilder.tsx",
    behaviorId: "spatial.rules.geofence-dwell-breach",
    docSlug: "docs/SIGNAL_INTELLIGENCE_SPATIAL_RULES.md",
    hint: "Governed Rules & Decision Intelligence (GRIE) configures H3 spatial geofences, ON_DWELL SLAs, and automated triage triggers.",
    action: "Inspect the H3 spatial rule configuration and automated escalation policy for critical generator telemetry anomalies.",
    steps: [
      {
        scoreDimension: "C",
        target: "[data-testid='rules-panel'], [data-testid='rule-builder'], [data-testid='rule-condition-row'], [data-testid='open-spatial-palette'], header",
        side: "bottom",
        title: "H3 Geo Event & Predicate Rule Configuration",
        description: "Governed Rules & Decision Intelligence Engine (GRIE) establishes the spatial threshold: evaluates res-9 hex geofences, ON_DWELL duration SLAs (>10 min), and temperature limits (>95°C) to autonomously dispatch the CREW Incident Squad.",
        action: "Inspect the H3 spatial rule configuration and automated escalation policy for critical generator telemetry anomalies.",
        hint: "GRIE evaluates res-9 hexagonal geofences with sub-second Kafka outbox streaming.",
      },
    ],
  },
  "snippet:rescue-war-room": {
    id: "snippet:rescue-war-room",
    title: "Autonomous CREW War Room",
    category: "copilot",
    targetRoute: "/workspace/chat/crew-rescue-dispatch-war-room",
    scoreDimension: "R",
    componentId: "crew-roster",
    sourceFile: "client/src/components/agent-chat/CrewRoster.tsx",
    behaviorId: "ai.crew.incident-war-room",
    docSlug: "docs/specs/rescue-dispatch-functional-spec.md",
    hint: "Autonomous agents deliberate on telemetry breaches, equipment schematics, and contract SLAs.",
    action: "Review agent dialogue and tactical recommendations for Commercial Generator #4.",
    steps: [
      {
        scoreDimension: "R",
        target: "[data-testid='crew-roster-container'], [data-testid='crew-roster'], [data-testid='crew-chat-input'], header",
        side: "bottom",
        title: "Autonomous CREW Incident War Room",
        description: "Specialized autonomous agent squad convenes in the Incident War Room to deliberate on triage priorities, evaluate equipment schematics, and recommend emergency dispatch.",
        action: "Review agent dialogue and tactical recommendations for Commercial Generator #4.",
        hint: "Agent deliberation verifies maintenance contract #MC-8842 before dispatch authorization.",
      },
    ],
  },
  "snippet:rescue-intake": {
    id: "snippet:rescue-intake",
    title: "Structured Intake & Data Input",
    category: "governance",
    targetRoute: "/a/rescue-dispatcher?prompt=Emergency:+Commercial+Generator+%234+(GEN-8842-X)+overheating+under+critical+load",
    scoreDimension: "O",
    componentId: "rescue-form-agent",
    sourceFile: "server/domain/agents/ui/modules/agents/pages/AgentDeploymentPage.tsx",
    behaviorId: "rescue.intake.structured-data-input",
    docSlug: "docs/specs/rescue-dispatch-functional-spec.md",
    hint: "Data input binds the incident to active maintenance contract #MC-8842 with 24/7 priority SLA.",
    action: "Input generator serial number GEN-8842-X and geocoded location, then trigger the automated Service Dispatch Pipeline.",
    steps: [
      {
        scoreDimension: "O",
        target: "input[placeholder*='message'], textarea, #serialNumber, button[role='combobox'], [data-testid='rescue-intake-form'], form, header",
        side: "bottom",
        title: "Structured Incident Intake & Data Input",
        description: "Requester AI Form Agent presents structured intake fields for data input: asset serial number (GEN-8842-X), geocoded address (200 N Spring St, Los Angeles, CA), and priority triage.",
        action: "Input generator serial number GEN-8842-X and geocoded location, then trigger the automated Service Dispatch Pipeline.",
        hint: "Data input binds the incident to active maintenance contract #MC-8842 with 24/7 priority SLA.",
      },
    ],
  },
  "snippet:rescue-dispatch-dashboard": {
    id: "snippet:rescue-dispatch-dashboard",
    title: "Tactical Dispatch & Squad Deploy",
    category: "cycles",
    targetRoute: "/app/rescue-dispatch",
    scoreDimension: "E",
    componentId: "tactical-dispatch-dashboard",
    sourceFile: "server/domain/rescue/ui/modules/rescue/components/TacticalDispatchDashboard.tsx",
    behaviorId: "operations.dispatch.tactical-squad-deploy",
    docSlug: "docs/specs/rescue-dispatch-functional-spec.md",
    hint: "Closed-loop dispatch automatically updates live provider location and SLA time tracking.",
    action: "Authorize squad deployment and monitor live telemetry handshake confirmation.",
    steps: [
      {
        scoreDimension: "E",
        target: "[data-testid='incident-panel'], [data-testid^='rescue-card-'], [data-testid='tactical-map'], main, header",
        side: "bottom",
        title: "Tactical Dispatch & Apex Squad Deploy",
        description: "Operations flight deck confirms SLA verification, displays real-time provider ETA, and authorizes Apex Field Response squad deployment.",
        action: "Authorize squad deployment and monitor live telemetry handshake confirmation.",
        hint: "Closed-loop dispatch automatically updates live provider location and SLA time tracking.",
      },
    ],
  },
  "snippet:identity-bridge-launchpad": {
    id: "snippet:identity-bridge-launchpad",
    title: "Enterprise Identity Bridge & Kafka Backbone",
    category: "discovery",
    targetRoute: "/launchpad",
    scoreDimension: "S",
    componentId: "identity-bridge-card",
    sourceFile: "server/domain/apps/ui/modules/apps/pages/CommandLaunchpadPage.tsx",
    behaviorId: "identity.bridge.launchpad-briefing",
    docSlug: "server/knowledge/features/prospecting-engine.md",
    hint: "Click to launch the autonomous zero-party de-anonymization and Kafka outbox walkthrough.",
    action: "Click to launch the 8s interactive tour across zero-party de-anonymization, reverse-IP firmographics, and Kafka-relayed co-pilot awakening.",
    steps: [
      {
        scoreDimension: "S",
        target: "[data-tutorial='identity-bridge-card'], [data-tutorial='identity-bridge-tour-trigger'], [data-testid='identity-bridge-card'], header",
        side: "bottom",
        title: "Enterprise Identity Bridge & Kafka Outbox Relay",
        description: "Real-time anonymous-to-known visitor resolution. Fuses web traffic, telemetry, reverse-IP firmographics, and zero-party form fills with transactional Kafka outbox streaming (spatial.signal.v1).",
        hint: "Step advances automatically every 8 seconds, or you can click Next at any time.",
      },
    ],
  },
  "snippet:identity-bridge-computer-use": {
    id: "snippet:identity-bridge-computer-use",
    title: "Autonomous Computer Use Agent & Virtual Desktop Browser",
    category: "discovery",
    targetRoute: "/launchpad",
    scoreDimension: "C",
    componentId: "identity-bridge-computer-use",
    sourceFile: "server/domain/apps/ui/modules/apps/pages/CommandLaunchpadPage.tsx",
    behaviorId: "identity.bridge.computer-use-agent",
    docSlug: "server/knowledge/features/prospecting-engine.md",
    hint: "Observe the live virtual desktop browser with realistic mouse movement and 24-step page history.",
    action: "Observe the simulated customer autonomously browsing, evaluating tiers, and submitting zero-party credentials.",
    steps: [
      {
        scoreDimension: "C",
        target: "[data-testid='virtual-computer-viewport'], [data-testid='run-computer-use-demo-btn'], [data-tutorial='identity-bridge-card'], header",
        side: "bottom",
        title: "Live Synthetic Customer Browser Behavior & Telemetry",
        description: "Watch the sandboxed Linux desktop agent autonomously browse Acme Operations Command. Follow the realistic mouse trajectories, dwell times, and keystroke typing cadence as the customer inspects infrastructure metrics, compares pricing tiers, fills out the deployed Form Builder, and streams multi-page behavioral events to Kafka.",
        action: "Observe the live browser behavior, mouse trajectories, and multi-page session history audit.",
        hint: "Paced realistically with human mouse movement, form typing cadence, and 24-event audit trails.",
      },
    ],
  },
  "snippet:identity-bridge-properties": {
    id: "snippet:identity-bridge-properties",
    title: "Federated Properties & Fleet Overview",
    category: "governance",
    targetRoute: "/armory/identity-bridge",
    scoreDimension: "C",
    componentId: "prospecting-dashboard",
    sourceFile: "server/domain/prospecting/ui/modules/prospecting/pages/ProspectingDashboard.tsx",
    behaviorId: "identity.properties.fleet-overview",
    docSlug: "server/knowledge/features/prospecting-engine.md",
    hint: "Each property coordinates domain-specific co-pilot personas and active JS harnesses.",
    action: "Inspect managed properties, assigned co-pilot personas, and client-side ingestion health.",
    steps: [
      {
        scoreDimension: "C",
        target: "[data-testid='identity-bridge-property-card'], [data-testid='identity-bridge-dashboard'], main, header",
        side: "bottom",
        title: "Managed Properties & Agent Personas",
        description: "Each managed property pairs a tracked domain with a dedicated AI Co-pilot persona (sales-pilot-agent) and secure client-side JS harness telemetry.",
        action: "Inspect managed properties, assigned co-pilot personas, and client-side ingestion health.",
        hint: "Supports up to 5 enterprise properties per tenant with independent isolation.",
      },
    ],
  },
  "snippet:identity-bridge-harness": {
    id: "snippet:identity-bridge-harness",
    title: "JS Harness & Integration Guide",
    category: "governance",
    targetRoute: "/armory/identity-bridge?propertyId=1&tab=setup",
    scoreDimension: "R",
    componentId: "prospecting-dashboard",
    sourceFile: "server/domain/prospecting/ui/modules/prospecting/pages/ProspectingDashboard.tsx",
    behaviorId: "identity.harness.embed-snippet",
    docSlug: "server/knowledge/features/prospecting-engine.md",
    hint: "Zero-dependency script tag handles batched event ingestion and identity synchronization.",
    action: "Review integration snippet and client-side identify API bindings.",
    steps: [
      {
        scoreDimension: "R",
        target: "[data-testid='identity-bridge-snippet-box'], [data-testid='identity-bridge-details-btn'], [role='tablist'], main, header",
        side: "bottom",
        title: "Zero-Latency Client-Side Harness & Identify API",
        description: "A lightweight <script> tag streams navigation events and exposes window.OddjobProspector.identify(userId, metadata) for one-line de-anonymization on login or form submission.",
        action: "Review integration snippet and client-side identify API bindings.",
        hint: "Embeds into any web property or forged app via a single script tag with origin protection.",
      },
    ],
  },
  "snippet:identity-bridge-leads": {
    id: "snippet:identity-bridge-leads",
    title: "Identified Leads & S.C.O.R.E. Attribution",
    category: "governance",
    targetRoute: "/armory/identity-bridge?propertyId=1&tab=leads",
    scoreDimension: "O",
    componentId: "prospecting-dashboard",
    sourceFile: "server/domain/prospecting/ui/modules/prospecting/pages/ProspectingDashboard.tsx",
    behaviorId: "identity.leads.score-attribution",
    docSlug: "server/knowledge/features/prospecting-engine.md",
    hint: "Anonymous sessions merge into rich account records with live S.C.O.R.E. intent tracking.",
    action: "Inspect de-anonymized accounts, identified stakeholders, and behavioral scoring.",
    steps: [
      {
        scoreDimension: "O",
        target: "[data-testid='identity-bridge-leads-table'], table, [data-testid='identity-bridge-property-card'], main, header",
        side: "bottom",
        title: "De-Anonymized Enterprise Leads & S.C.O.R.E.",
        description: "Anonymous session cookies fuse into corporate identities with decayed S.C.O.R.E. vectors preserved across merges. Each resolution commits an atomic outbox event to Kafka without dropped leads.",
        action: "Inspect de-anonymized accounts, identified stakeholders, and behavioral scoring.",
        hint: "BANT qualification automatically scores budget, authority, need, timeline, and effect.",
      },
    ],
  },
  "snippet:identity-bridge-timeline": {
    id: "snippet:identity-bridge-timeline",
    title: "Lead Engagement Timeline & Behavioral Digital Twin",
    category: "governance",
    targetRoute: "/armory/identity-bridge?propertyId=1&tab=timeline&leadId=1",
    scoreDimension: "R",
    componentId: "prospecting-dashboard",
    sourceFile: "server/domain/prospecting/ui/modules/prospecting/pages/ProspectingDashboard.tsx",
    behaviorId: "identity.leads.behavioral-timeline",
    docSlug: "server/knowledge/features/prospecting-engine.md",
    hint: "Every click, page view, form fill, and dwell event is sequenced in chronological order.",
    action: "Review the full session history and behavioral digital twin of the selected enterprise lead.",
    steps: [
      {
        scoreDimension: "R",
        target: "[data-testid='identity-bridge-tab-timeline'], [data-testid='identity-bridge-timeline-back-btn'], [data-testid='identity-bridge-leads-table'], main, header",
        side: "bottom",
        title: "Lead Engagement History & Behavioral Digital Twin",
        description: "Clicking any lead or the action button opens the Activity Timeline. Here, operators inspect the raw behavioral event stream — page views, clicks, dwell times, and form inputs — captured across domains before and after de-anonymization.",
        action: "Review the full session history and behavioral digital twin of the selected enterprise lead.",
        hint: "All events stream into Kafka and PostgreSQL with sub-second latency.",
      },
    ],
  },
  "snippet:identity-bridge-copilot": {
    id: "snippet:identity-bridge-copilot",
    title: "Omniscient AI Co-pilot Intervention",
    category: "copilot",
    targetRoute: "/workspace/chat/crew-rescue-dispatch-war-room",
    scoreDimension: "E",
    componentId: "crew-roster",
    sourceFile: "client/src/components/agent-chat/CrewRoster.tsx",
    behaviorId: "identity.copilot.proactive-intervention",
    docSlug: "server/knowledge/features/prospecting-engine.md",
    hint: "Autonomous CREW agents ingest real-time visitor signals to deliver proactive interventions.",
    action: "Deliberate on de-anonymized intent signals and launch high-conversion outreach.",
    steps: [
      {
        scoreDimension: "E",
        target: "[data-testid='crew-chat-input'], [data-testid='crew-roster-container'], [data-testid='crew-roster'], header",
        side: "bottom",
        title: "Kafka Signal Delivery & Autonomous CREW Handoff",
        description: "Identity Bridge streams spatial.signal.v1 observations directly to Kafka. Autonomous CREW squads ingest the de-anonymized intent signals in real time, delivering proactive, hyper-contextual outreach.",
        action: "Deliberate on de-anonymized intent signals and launch high-conversion outreach.",
        hint: "Cross-session memory retains prospect activity across visits and domains.",
      },
    ],
  },
};

/** Pre-composed Instructional Chains */
export const CANONICAL_CHAINS: Record<string, TutorialChain> = {
  "chain:identity-bridge": {
    id: "chain:identity-bridge",
    name: "Enterprise Identity Bridge Interactive Experience",
    description: "Autonomous visitor de-anonymization tour across property fleet management, JS harness embed, identified accounts, and AI co-pilot intervention.",
    autoNavigate: true,
    intervalMs: 8000,
    snippetIds: [
      "snippet:identity-bridge-launchpad",
      "snippet:identity-bridge-computer-use",
      "snippet:identity-bridge-properties",
      "snippet:identity-bridge-harness",
      "snippet:identity-bridge-leads",
      "snippet:identity-bridge-timeline",
      "snippet:identity-bridge-copilot",
    ],
  },
  "chain:film-production-studio": {
    id: "chain:film-production-studio",
    name: "AI Film Production Studio Interactive Experience",
    description: "Autonomous virtual studio tour across narrative scripting, crew deliberation, visual keyframes, HIL dailies approval, and conformed timeline delivery.",
    autoNavigate: true,
    intervalMs: 8000,
    snippetIds: [
      "snippet:film-studio",
      "snippet:crew-roster",
      "snippet:film-storyboard",
      "snippet:film-shots-dailies",
      "snippet:film-conformed-timeline",
    ],
  },
  "chain:rescue-dispatch": {
    id: "chain:rescue-dispatch",
    name: "Emergency Rescue & Dispatcher Interactive Experience",
    description: "Autonomous crisis response tour across H3 spatial telemetry, Geo Event rule configuration, CREW war room triage, structured data intake, and rapid squad dispatch.",
    autoNavigate: true,
    intervalMs: 8000,
    snippetIds: [
      "snippet:rescue-launchpad",
      "snippet:rescue-spatial",
      "snippet:rescue-geo-rule",
      "snippet:rescue-war-room",
      "snippet:rescue-intake",
      "snippet:rescue-dispatch-dashboard",
    ],
  },
  "chain:executive-overview": {
    id: "chain:executive-overview",
    name: "Executive S.C.O.R.E. Platform Briefing",
    description: "High-level tour across discovery, live telemetry, copilot assistance, and tenant governance.",
    autoNavigate: true,
    snippetIds: ["snippet:discovery", "snippet:telemetry", "snippet:copilot", "snippet:governance"],
  },
  "chain:developer-forge": {
    id: "chain:developer-forge",
    name: "Developer App Forge & Architecture Track",
    description: "Guide to discovering and scaffolding apps with 34 canonical blueprints and AI assistance.",
    autoNavigate: true,
    snippetIds: ["snippet:discovery", "snippet:app-forge", "snippet:copilot"],
  },
  "chain:operator-flight-deck": {
    id: "chain:operator-flight-deck",
    name: "Operator Flight Deck & Cycle Simulation",
    description: "Operational workflow from spend telemetry to visual DAG cycle simulation and tenant governance.",
    autoNavigate: true,
    snippetIds: ["snippet:telemetry", "snippet:cycle-builder", "snippet:governance"],
  },
  "chain:spatial-operator": {
    id: "chain:spatial-operator",
    name: "Eulerian Spatial & Telemetry Command Track",
    description: "Deep-dive into live spend telemetry, Uber H3 hexagonal spatial analytics, and operational cycle flow.",
    autoNavigate: true,
    snippetIds: ["snippet:telemetry", "snippet:spatial-intelligence", "snippet:cycle-builder"],
  },
  "chain:enterprise-architect": {
    id: "chain:enterprise-architect",
    name: "Enterprise Architecture & Governance Track",
    description: "Full governance workflow across discovery, 34 app blueprints, project spaces, HIL approvals, and tenant security.",
    autoNavigate: true,
    snippetIds: ["snippet:discovery", "snippet:app-forge", "snippet:project-spaces", "snippet:hil-gates", "snippet:governance"],
  },
  "chain:builder-pod-mastery": {
    id: "chain:builder-pod-mastery",
    name: "Governed AI Builder Pods & Tool Assembly Track",
    description: "Explore AI Co-pilot collaboration, mounting isolated builder pods, and running visual cycle simulations.",
    autoNavigate: true,
    snippetIds: ["snippet:copilot", "snippet:builder-pods", "snippet:cycle-builder"],
  },
  "chain:full-platform-immersion": {
    id: "chain:full-platform-immersion",
    name: "Full S.C.O.R.E. Platform Immersion (All Dimensions)",
    description: "Comprehensive walkthrough touching all S.C.O.R.E. dimensions across every major Oddjob subsystem.",
    autoNavigate: true,
    snippetIds: [
      "snippet:discovery",
      "snippet:telemetry",
      "snippet:spatial-intelligence",
      "snippet:app-forge",
      "snippet:project-spaces",
      "snippet:copilot",
      "snippet:builder-pods",
      "snippet:cycle-builder",
      "snippet:hil-gates",
      "snippet:governance",
    ],
  },
};

export const TUTORIAL_CHAINS = CANONICAL_CHAINS;

/** Assembles an array of atomic snippets into a cohesive chained TutorialDefinition */
export function createChainedTutorial(chain: TutorialChain): TutorialDefinition {
  const steps: TutorialStep[] = [];
  const totalModules = chain.snippetIds.length;

  chain.snippetIds.forEach((snippetId, moduleIdx) => {
    const snippet = TUTORIAL_SNIPPETS[snippetId];
    if (!snippet) {
      console.warn(`[TutorialEngine] Unknown snippet in chain "${chain.id}": ${snippetId}`);
      return;
    }

    const snippetSteps = snippet.steps.map((step, stepIdx) => {
      const isLastInSnippet = stepIdx === snippet.steps.length - 1;
      const isLastInChain = moduleIdx === totalModules - 1 && isLastInSnippet;

      const nextSnippetId = chain.snippetIds[moduleIdx + 1];
      const nextSnippetTitle = nextSnippetId ? TUTORIAL_SNIPPETS[nextSnippetId]?.title : undefined;

      return {
        ...step,
        targetRoute: snippet.targetRoute || step.targetRoute,
        moduleTitle: snippet.title,
        moduleIndex: moduleIdx + 1,
        totalModules,
        shortcut: step.shortcut || snippet.shortcut,
        hint: step.hint || snippet.hint,
        docSlug: step.docSlug || snippet.docSlug,
        componentId: step.componentId || snippet.componentId,
        nextLabel: isLastInChain
          ? (step.nextLabel || "Complete Full Walkthrough")
          : (isLastInSnippet && nextSnippetTitle ? `Next: ${nextSnippetTitle}` : (step.nextLabel || "Next Step")),
      };
    });

    steps.push(...snippetSteps);
  });

  return {
    id: chain.id,
    name: chain.name,
    category: "chained-demo",
    intervalMs: chain.intervalMs,
    steps,
  };
}

/** Built-in Canonical S.C.O.R.E. Tutorials */
export const CANONICAL_TUTORIALS: Record<string, TutorialDefinition> = {
  "identity-bridge-tour": createChainedTutorial(CANONICAL_CHAINS["chain:identity-bridge"]),
  "film-studio-tour": createChainedTutorial(CANONICAL_CHAINS["chain:film-production-studio"]),
  "rescue-dispatch-tour": createChainedTutorial(CANONICAL_CHAINS["chain:rescue-dispatch"]),
  "platform-score-tour": createChainedTutorial(CANONICAL_CHAINS["chain:executive-overview"]),
  "create-mission-walkthrough": {
    id: "create-mission-walkthrough",
    name: "Creating an Autonomous Mission",
    category: "missions",
    targetRoute: "/missions",
    steps: [
      {
        scoreDimension: "S",
        target: "[data-testid='new-mission-button'], button:has-text('New Mission'), a:has-text('New Mission'), button:has(.lucide-plus)",
        side: "bottom",
        title: "Initiate Mission Goal",
        description: "Every mission begins with a clear objective. Click here to open the strategic mission builder.",
      },
      {
        scoreDimension: "C",
        target: "[data-testid='mission-ticker'], [data-testid='header-mission-ticker'], header",
        side: "bottom",
        title: "Autonomous Swarm Orchestration",
        description: "Oddjob coordinates specialized agents and tools to fulfill your mission within designated execution cycles.",
      },
      {
        scoreDimension: "R",
        target: "button:has(.lucide-sparkles)",
        side: "bottom",
        title: "Safeguards & Spend Soft-Caps",
        description: "Set hard token and dollar budgets. Oddjob's 5-layer control plane halts execution if spend approaches thresholds.",
      },
      {
        scoreDimension: "O",
        target: "header, nav, [data-testid='sidebar-inset']",
        side: "bottom",
        title: "Verification & Telemetry Stream",
        description: "Once launched, live mission status, logs, and outputs stream continuously to your flight deck and header ticker.",
        nextLabel: "Complete Mission Guide",
      },
    ],
  },
};

/**
 * Every id startTutorial can resolve: curated chains, standalone tutorials and
 * individual snippets. Anything not in here reaches a user as a button that
 * warns to the console and does nothing.
 */
export function getLaunchableTutorialIds(): string[] {
  return [
    ...Object.keys(CANONICAL_CHAINS),
    ...Object.keys(CANONICAL_TUTORIALS),
    ...Object.keys(TUTORIAL_SNIPPETS),
  ];
}

/** Returns all available canonical chains */
export function getAllTutorialChains(): Record<string, TutorialChain> {
  return CANONICAL_CHAINS;
}

/** Returns all available atomic snippets */
export function getAllTutorialSnippets(): Record<string, TutorialSnippet> {
  return TUTORIAL_SNIPPETS;
}
