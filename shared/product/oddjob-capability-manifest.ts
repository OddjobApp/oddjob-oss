export type OddjobPillarId = "missions" | "forge" | "knowledge" | "control" | "spatial";
export type OddjobCapabilityMaturity = "foundation" | "maturing" | "advanced" | "experimental";

export interface OddjobPillar {
    id: OddjobPillarId;
    name: string;
    buyerLabel: string;
    promise: string;
    proofPoints: string[];
}

export interface OddjobCapability {
    id: string;
    pillar: OddjobPillarId;
    name: string;
    /**
     * A CEILING, not a claim.
     *
     * The reported maturity is derived from evidence that exists — an
     * executable contract, canonical demos, executable readiness checks — by
     * `deriveCapabilityMaturity`. See docs/CAPABILITY_MATURITY_RUBRIC.md.
     *
     * Setting this to "advanced" does not make a capability advanced; it only
     * declines to cap it below what the artifacts already earn. Setting it
     * LOWER is meaningful: it is how you say "this works, but we are not
     * standing behind it yet". This field used to be the reported value
     * outright, which made every level an assertion no evidence could
     * contradict.
     */
    maturity: OddjobCapabilityMaturity;
    buyerValue: string;
    implementationSignals: string[];
    primarySurfaces: string[];
    hardeningFocus: string[];
    copilotNextActions: string[];
}

export interface OddjobCanonicalDemo {
    id: string;
    title: string;
    buyerQuestion: string;
    outcome: string;
    capabilityIds: string[];
    setupNotes: string[];
    successCriteria: string[];
    guidedPrompt: string;
}

export interface OddjobReadinessCheck {
    id: string;
    label: string;
    pillar: OddjobPillarId;
    priority: "p0" | "p1" | "p2";
    command?: string;
    expected: string;
}

export interface OddjobCopilotCommand {
    id: string;
    label: string;
    pillar: OddjobPillarId;
    riskLevel: "low" | "medium" | "high";
    requiresApproval: boolean;
    intent: string;
    suggestedTools: string[];
    userFacingResult: string;
}

export interface OddjobCopilotTrustQuestion {
    id: string;
    question: string;
    answerShouldInclude: string[];
}

export interface OddjobCopilotGuide {
    operatingMode: string;
    firstRunPrompt: string;
    defaultObjectTypes: string[];
    guidedFlows: string[];
    commands: OddjobCopilotCommand[];
    trustQuestions: OddjobCopilotTrustQuestion[];
}

export const ODDJOB_POSITIONING = {
    category: "Governed Agentic Operations Engine",
    oneLiner: "Oddjob plans, executes, governs, replays, and improves autonomous work across agents, tools, generated apps, knowledge, and computer-use sessions.",
    buyerMessage: "For technical operations teams that need agents to do real work safely, Oddjob is the system of record for governed autonomous work.",
    avoidPositioningAs: [
        "generic chatbot",
        "simple no-code automation builder",
        "single-model agent demo",
        "RPA-only desktop recorder",
    ],
    leadWith: [
        "durable missions",
        "human approvals",
        "replayable actions",
        "generated internal apps",
        "knowledge-grounded execution",
        "location-aware signal intelligence",
        "computer-use fallback when APIs are unavailable",
    ],
} as const;

export const ODDJOB_PILLARS: OddjobPillar[] = [
    {
        id: "missions",
        name: "Missions",
        buyerLabel: "Long-running autonomous work",
        promise: "Turn messy operational goals into durable, governed work that can pause, resume, delegate, and report progress.",
        proofPoints: [
            "mission lifecycle services",
            "rolling-wave and dynamic orchestration",
            "mission replay and reporting",
            "self-healing and retry services",
        ],
    },
    {
        id: "forge",
        name: "Forge",
        buyerLabel: "Generated internal apps",
        promise: "Generate, validate, deploy, and evolve operational apps when recurring work needs a durable interface.",
        proofPoints: [
            "App Forge planning and code generation",
            "QA and validator services",
            "deployment and versioning services",
            "visual builder and app intelligence tabs",
        ],
    },
    {
        id: "knowledge",
        name: "Knowledge",
        buyerLabel: "Grounded memory and context",
        promise: "Ground work in reusable organizational knowledge, mission memory, RAG, graph context, and execution traces.",
        proofPoints: [
            "Knowledge Store",
            "Qdrant-backed RAG",
            "graph-RAG services",
            "mission history memory",
        ],
    },
    {
        id: "control",
        name: "Control",
        buyerLabel: "Governance, approval, replay, and computer use",
        promise: "Make autonomous work inspectable and safe with approvals, redaction, policy gates, audit timelines, and replayable computer actions.",
        proofPoints: [
            "governor services",
            "approval routes",
            "Trycua sessions and computer-use task replay",
            "constitutional critique and budget guards",
        ],
    },
    {
        id: "spatial",
        name: "Spatial",
        buyerLabel: "Location-aware signal intelligence",
        promise: "Resolve location-bearing signals into queryable spatial context and act on where assets actually are — without ever mistaking an unknown position for a known one.",
        proofPoints: [
            "H3 hexagonal spatial engines",
            "geofence rasterization and membership",
            "spatial rule suites over live signal feeds",
            "positional precision gating before rule evaluation",
        ],
    },
];

export const ODDJOB_CAPABILITIES: OddjobCapability[] = [
    {
        id: "formal-layout-and-governance-verification",
        pillar: "forge",
        name: "Formal Layout & AI Governance Verification Engine",
        maturity: "advanced",
        buyerValue: "Continuous SMT/QF_LRA layout invariant proofs, closed-form MaxSMT CSS clamp() synthesis, DPLL SAT package resolution, and Horn Clause AI safety guards.",
        implementationSignals: [
            "server/domain/scaffold/formal/layout-formal.service.ts",
            "server/domain/scaffold/sat-scaffold-resolver.ts",
            "server/domain/governance/formal-governance.guard.ts",
            "server/domain/scaffold/formal/wcag-token-synthesizer.ts",
            "server/domain/mission/formal/mission-schedulability-prover.ts",
            "packages/design-system/src/components/FormalLayout.tsx",
        ],
        primarySurfaces: [
            "/api/scaffold",
            "/api/qa",
            "/workspace/canvas",
        ],
        hardeningFocus: [
            "continuous QF_LRA interval proofs across viewport spectrum",
            "closed-form MaxSMT responsive CSS synthesis",
            "Constrained Horn Clause model-checking for agent safety",
            "WCAG 2.2 relative luminance dynamic token synthesis",
        ],
        copilotNextActions: [
            "Formally verify UI layouts across continuous viewport spectrums.",
            "Synthesize closed-form responsive CSS clamp() definitions.",
            "Prove agent workflow graphs cannot bypass Human-in-the-Loop approval nodes.",
        ],
    },
    {
        id: "presentation-crew-layout",
        pillar: "forge",
        name: "Presentation Crew & Document Layout Engine",
        maturity: "advanced",
        buyerValue: "Sculpt raw markdown into structured DocumentBlockAST presentation decks, whitepapers, executive briefs, and promotional graphics with 4-agent creative orchestration.",
        implementationSignals: [
            "server/domain/crew/core/presentation-crew.service.ts",
            "server/domain/knowledge/core/presentation-assembly.service.ts",
            "server/domain/knowledge/core/presentation-media.service.ts",
            "server/knowledge/features/presentation-and-document-layout.md",
        ],
        primarySurfaces: [
            "/api/presentation-crew/orchestrate",
            "/workspace/chat",
        ],
        hardeningFocus: [
            "distilling raw text into atomic document blocks",
            "synthesizing visual themes and hero media",
            "verifying WCAG contrast standards and HIL approval gates",
        ],
        copilotNextActions: [
            "Generate a presentation deck or executive brief from project context.",
            "Layout document text into polished visual slides using the 4-agent creative crew.",
        ],
    },
    {
        /**
         * Added to the canonical list, which never gained it: the executable
         * manifests carried scribe_studio from 2c267b493 while this list still
         * named only presentation-crew-layout, so the two sides disagreed and
         * the coverage test failed on the difference.
         */
        id: "scribe-studio",
        pillar: "forge",
        name: "Scribe Studio",
        maturity: "advanced",
        buyerValue: "Nonlinear longform authoring with a station spine, multi-lens critic auditing anchored to the passage it judges, branch diffing, and DOCX/PDF/Markdown export.",
        implementationSignals: [
            "client/src/modules/scribe/ScribeStudioPod.tsx",
            "server/domain/scribe/core/scribe-intent-resolver.service.ts",
            "server/domain/tools/v1/capabilities/scribe.ts",
        ],
        primarySurfaces: [
            "/workspace/chat",
            "/api/scribe/export",
        ],
        hardeningFocus: [
            "anchoring critic findings to the passage they are about",
            "retiring critiques whose text no longer exists",
            "keeping the manuscript readable while docks and rails compete for width",
        ],
        copilotNextActions: [
            "Open Scribe Studio to draft a document, contract, or manuscript.",
            "Audit an existing draft through the critic lenses and apply the accepted edits.",
        ],
    },
    {
        id: "durable-missions",
        pillar: "missions",
        name: "Durable Missions",
        maturity: "advanced",
        buyerValue: "Operational goals become trackable work units rather than one-off prompts.",
        implementationSignals: [
            "server/domain/mission/core/mission-lifecycle.service.ts",
            "server/domain/mission/core/mission-run.service.ts",
            "server/domain/mission/core/mission-execution.service.ts",
            "server/domain/mission/core/mission-blackboard.schema.ts",
            "server/domain/mission/core/memory.service.ts",
            "server/domain/mission/core/deliverable.service.ts",
            "server/domain/mission/core/mission-timeline.service.ts",
        ],
        primarySurfaces: [
            "/missions",
            "/api/missions",
            "/api/mission-runs",
            "/api/workstreams",
            "/api/deliverables",
        ],
        hardeningFocus: [
            "single golden-path mission creation flow",
            "mission smoke tests",
            "resume/retry failure coverage",
            "blackboard growth bounded by context pruning on long runs",
        ],
        copilotNextActions: [
            "Guide a first mission from objective to approval-ready plan.",
            "Summarize active, blocked, failed, and waiting-on-human missions.",
            "Explain the current mission run from blackboard, dynamic trace, and resume condition.",
        ],
    },
    {
        id: "governed-approvals",
        pillar: "control",
        name: "Governed Approvals",
        maturity: "advanced",
        buyerValue: "High-impact actions can pause for human review before touching real systems.",
        implementationSignals: [
            "server/routes/approvals.ts",
            "server/domain/governor/core",
            "server/domain/mission/supervisor/guards",
        ],
        primarySurfaces: ["/approvals", "/api/approvals", "/api/governor"],
        hardeningFocus: [
            "shared policy classes",
            "exportable approval audit bundles",
            "consistent risk labels across domains",
        ],
        copilotNextActions: [
            "Surface pending approvals with risk, affected objects, and recommended decision context.",
            "Explain why an action requires approval and what will happen if rejected.",
            "Prepare an exportable audit bundle for a governed action.",
        ],
    },
    {
        id: "computer-use-replay",
        pillar: "control",
        name: "Computer Use With Replay & Teach-a-Task",
        maturity: "advanced",
        buyerValue: "Agents can operate GUI software with accessibility-tree observation, grounded target confidence, confirmation, redaction, verification screenshots, Teach-a-Task demonstration recording, Socratic parameter clarification, and replayable task history.",
        implementationSignals: [
            "server/domain/integrations/trycua/computer-use-task.service.ts",
            "server/domain/integrations/trycua/computer-intelligence.service.ts",
            "server/domain/integrations/trycua/learned-skills.service.ts",
            "server/domain/knowledge/knowledge.service.ts",
            "server/domain/ai/core/good-question-engine.ts",
            "client/src/components/agent-chat/CrewComposer.tsx",
            "client/src/components/agent-chat/InlineApprovalCard.tsx",
            "shared/computer-use-skill.ts",
            "shared/schema/integrations/trycua.ts",
        ],
        primarySurfaces: [
            "/workspace/chat",
            "/workspace/computer",
            "/admin/settings/computer-use",
            "/api/integrations/trycua/computer-use/tasks",
            "/api/integrations/trycua/sessions/:sessionId/guided-actions",
            "/api/integrations/trycua/sessions/:sessionId/observe",
            "/api/integrations/trycua/sessions/:sessionId/accessibility",
            "/api/integrations/trycua/skills",
        ],
        hardeningFocus: [
            "Socratic parameter ambiguity detection (entropy threshold ΔH > 0.60) and runtime Zod compilation",
            "In-chat CAPTCHA / 2FA human-in-the-loop solver with visual screenshot diffing",
            "Universal action step normalization and Knowledge Garden bi-directional cross-indexing",
            "provider-specific accessibility-tree coverage",
            "grounding benchmark fixtures",
            "prompt-injection policy",
            "approval and replay export bundles",
        ],
        copilotNextActions: [
            "Trigger in-chat Teach Mode (/teach [goal]) to record browser demonstration workflows.",
            "Clarify ambiguous task parameters via Socratic FormAgent question cards.",
            "Solve interactive CAPTCHA / 2FA challenges directly within CREW Chat inline cards.",
            "Create a confirmation-required computer-use task for GUI-only work.",
            "Show proposed target, grounding confidence, redactions, and verification result.",
            "Replay a completed computer-use step trail for audit review.",
        ],
    },
    {
        id: "app-forge",
        pillar: "forge",
        name: "App Forge",
        maturity: "advanced",
        buyerValue: "Teams can generate internal tools that sit beside the autonomous work they support.",
        implementationSignals: [
            "server/domain/apps/core/forge-codegen.service.ts",
            "server/domain/apps/core/forge-qa.service.ts",
            "server/domain/apps/app-deployment.service.ts",
        ],
        primarySurfaces: ["/apps", "/forge", "/api/apps"],
        hardeningFocus: [
            "template gallery for repeatable demos",
            "production readiness checklist",
            "baseline QA and accessibility gates",
        ],
        copilotNextActions: [
            "Convert a recurring mission pattern into an internal ops app proposal.",
            "Run Forge planning, generation, QA, and publish-readiness review as a governed flow.",
            "Explain app deployment readiness from validation and approval state.",
        ],
    },
    {
        id: "knowledge-grounding",
        pillar: "knowledge",
        name: "Knowledge Grounding",
        maturity: "advanced",
        buyerValue: "Agents and missions can retrieve trusted organizational context instead of starting from empty prompts.",
        implementationSignals: [
            "server/domain/knowledge/core/knowledge.service.ts",
            "server/domain/knowledge/core/rag",
            "server/domain/knowledge/core/graph-rag",
        ],
        primarySurfaces: ["/knowledge", "/api/knowledge"],
        hardeningFocus: [
            "source confidence display",
            "memory expiry and contradiction handling",
            "mission-to-knowledge provenance",
        ],
        copilotNextActions: [
            "Attach trusted knowledge to a mission and show source provenance.",
            "Detect conflicting or stale knowledge before acting on it.",
            "Answer operational questions using ontology objects plus knowledge graph evidence.",
        ],
    },
    {
        id: "prediction-intelligence",
        pillar: "missions",
        name: "Prediction Intelligence",
        maturity: "experimental",
        buyerValue: "Operational events can become forecasts, risk branches, and recommended interventions.",
        implementationSignals: [
            "shared/schema/prediction",
            "server/domain/prediction-intelligence",
            "migrations/0052_prediction_intelligence_quant_pod.sql",
        ],
        primarySurfaces: ["/predictive", "/api/prediction"],
        hardeningFocus: [
            "one concrete prediction use case",
            "branch confidence calibration",
            "explainable evidence trail",
        ],
        copilotNextActions: [
            "Keep predictions advisory until replay validation and calibration evidence exist.",
            "Explain forecast drivers, confidence, and recommended intervention boundaries.",
            "Suggest a concrete prediction pilot only after a mission or event stream is selected.",
        ],
    },
    {
        id: "adaptive-planning",
        pillar: "missions",
        name: "Adaptive Planning",
        maturity: "advanced",
        buyerValue: "A messy objective becomes a structured plan with named steps, tool affordances, dependencies, and cost and duration estimates before any work runs.",
        implementationSignals: [
            "server/domain/pipeline/core/planning/structured-planning.service.ts",
            "server/domain/mission/core/predictive-planning.service.ts",
            "server/domain/mission/core/mission-analyst.service.ts",
            "server/domain/mission/core/affordance-map.service.ts",
            "server/domain/mission/core/cycle-dag.service.ts",
            "server/domain/mission/core/synthesis-governor.service.ts",
        ],
        primarySurfaces: ["/missions", "/api/missions", "/api/pipelines"],
        hardeningFocus: [
            "plan estimates calibrated against observed run cost and duration",
            "affordance map reflecting the tools an agent can actually reach, not the full registry",
            "explicit failure when a plan references a capability the caller cannot invoke",
            "replanning that preserves completed work rather than restarting the objective",
        ],
        copilotNextActions: [
            "Turn an objective into a reviewable plan and show the steps, tools, and dependencies before running anything.",
            "State the estimated cost and duration of a plan, and say when the estimate is uncalibrated.",
            "Explain what a replan changed and which completed steps were preserved.",
        ],
    },
    {
        id: "multi-strategy-execution",
        pillar: "missions",
        name: "Multi-Strategy Execution",
        maturity: "advanced",
        buyerValue: "Work runs under the execution strategy that fits it — fully planned, autonomous, wave-based, parallel, event-triggered, or gated on a human at every step.",
        implementationSignals: [
            "shared/schema/missions/core.ts",
            "server/domain/mission/core/dynamic-orchestrator.service.ts",
            "server/domain/mission/core/rolling-wave-orchestrator.service.ts",
            "server/domain/mission/core/parallel-fan-out-orchestrator.service.ts",
            "server/domain/mission/core/reactive-orchestrator.service.ts",
            "server/domain/mission/core/human-driven-orchestrator.service.ts",
            "server/domain/mission/core/orchestration/llm-compiler-orchestrator.service.ts",
        ],
        primarySurfaces: ["/missions", "/api/missions", "/api/mission-runs", "/api/crisis"],
        hardeningFocus: [
            // Runtime validation now rejects an unknown strategy at dispatch
            // (isExecutionStrategy), but the column itself is still plain text —
            // a bad value can be written and only fails when the mission runs.
            "execution_strategy is still untyped text in the database; validation happens at dispatch, not on write",
            "per-strategy coverage so a rarely-used orchestrator cannot rot unnoticed",
            "consistent pause, resume, and cancel semantics across every strategy",
        ],
        copilotNextActions: [
            "Recommend an execution strategy from the shape of the work, and explain the trade-off it makes.",
            "Say which strategy a running mission is using and what will cause it to advance or wake.",
            "Use human_driven when an objective touches systems the user has not authorized.",
        ],
    },
    {
        id: "resilient-execution",
        pillar: "missions",
        name: "Resilient Execution",
        maturity: "advanced",
        buyerValue: "Long-running work survives transient failure — retrying with backoff, breaking circuits on failing tools, healing known failure patterns, and escalating what it cannot fix.",
        implementationSignals: [
            "server/domain/mission/core/retry.service.ts",
            "server/domain/mission/core/circuit-breaker.service.ts",
            "server/domain/mission/core/self-healing.service.ts",
            "server/domain/mission/core/workflow-healing.service.ts",
            "server/domain/mission/utils/rescue-strategy-factory.ts",
            "server/domain/mission/core/escalation.service.ts",
            "server/domain/mission/supervisor/guards/budget-guard.ts",
            "server/domain/mission/core/workspace-mutex.service.ts",
        ],
        primarySurfaces: ["/missions", "/api/mission-runs", "/api/approvals"],
        hardeningFocus: [
            "rescue strategies (retry, relax, skip, replan) chosen from evidence rather than order",
            "self-healing that never silently masks a failure the operator needed to see",
            "budget and SLA guards that halt rather than degrade quality invisibly",
            "escalation paths that reach a human before a mission exhausts its budget",
        ],
        copilotNextActions: [
            "Explain why a mission retried, which rescue strategy was applied, and what it changed.",
            "Surface a mission that is repeatedly self-healing — recovery is not the same as success.",
            "Report when a run stopped on a budget or SLA guard rather than on the work being complete.",
        ],
    },
    {
        id: "spatial-signals",
        pillar: "spatial",
        name: "Spatial Signal Intelligence",
        maturity: "advanced",
        buyerValue: "Location-bearing events become queryable spatial context — H3 hex aggregation, geofences, and rule-driven actions over where things actually are.",
        implementationSignals: [
            "server/domain/signal-intelligence/core/signal-ingestion.service.ts",
            "server/domain/ai/core/h3-hexagonal-spatial-engine.service.ts",
            "server/domain/ai/core/h3-geofence-rasterizer.service.ts",
            "server/domain/ai/core/geofence-spatial-engine.service.ts",
            "client/src/components/signal-intelligence/spatial",
        ],
        primarySurfaces: [
            "/signal-intelligence",
            "/api/signals",
            "/api/signal-feeds",
            "/api/rule-suites",
            "/api/spatial/kafka",
        ],
        hardeningFocus: [
            // Safety-critical and load-bearing: a low-precision fix (e.g. a
            // country centroid) reads as a definite position, so an exclusion
            // rule can fire on an asset whose location is actually unknown.
            "positional precision gating before any rule evaluates",
            "explicit unknown-position handling distinct from outside-geofence",
            "operator-visible provenance for the resolution behind each fix",
            "spatial term weighting made explicit rather than a fixed constant",
        ],
        copilotNextActions: [
            "Explain what a spatial rule will match before it is armed, including which assets have unknown positions.",
            "State the positional precision behind an answer rather than implying a fix is exact.",
            "Never assert an asset is outside a geofence when its position is unknown — say it is undetermined.",
        ],
    },
    {
        id: "crew-collaboration",
        pillar: "missions",
        name: "CREW Multi-Agent Collaboration",
        maturity: "advanced",
        buyerValue: "A room of specialist agents can deliberate on a problem, reach consensus, and write what they learn back into organizational knowledge.",
        implementationSignals: [
            "server/domain/crew/core/crew-orchestrator.service.ts",
            "server/domain/crew/core/crew-participants.service.ts",
            "server/domain/crew/core/crew-triage.service.ts",
            "server/domain/crew/core/crew-learning.service.ts",
            "server/domain/crew/api/crew.routes.ts",
            "server/domain/crew/core/crew-mounted-app-context.service.ts",
            "server/domain/crew/core/crew-surface-approval.ts",
            "server/middleware/crew-app-activity-bridge.ts",
            "shared/crew-surface-request.ts",
            "shared/crew-surface-connections.ts",
            "server/domain/apps/platform/blueprint-crew-contract.test.ts",
        ],
        // Crew rooms are addressable: /workspace/chat/<sessionKey> is served by
        // OperationsRouting, so a room is a shareable link, not just an API.
        primarySurfaces: [
            "/workspace/chat",
            "/workspace/chat/:roomKey",
            "/api/crew",
            "/api/crew/rooms",
            "/api/crew/:sessionKey/stream",
        ],
        hardeningFocus: [
            "project scoping on every read path so private work cannot surface cross-project",
            "consensus thresholds that are inspectable rather than implicit",
            "streamed turns that reconcile cleanly after a dropped connection",
            "room discoverability verified — /api/crew/rooms and ProjectRoomsTab index fully operational",
            "mounted-app context resolved server-side — browser path/selection are hints, never evidence",
            "embedded blueprint contract held by the hermetic blueprint-crew-contract gate, not by convention",
        ],
        copilotNextActions: [
            "Recruit only agents relevant to the question, and say plainly when none are.",
            "Summarize where the room agreed, where it split, and what was written back to knowledge.",
            "Show which project scope a crew answer was drawn from before acting on it.",
        ],
    },
    {
        id: "crew-mobile",
        pillar: "missions",
        name: "CREW on Android",
        // Experimental is a deliberate ceiling: the app talks to the same /api/crew
        // routes as the web room and is verified on an emulator, and phone push
        // works end to end since 8 Oct 2026 (FCM, keyless), but there is no signed
        // release build and no canonical demo yet.
        maturity: "experimental",
        buyerValue: "Squad members take part in CREW rooms from their phone: follow the room live, choose which agents answer them, message the crew, work with the Gmail, Calendar, Drive, YouTube, Amazon and FlightHub results it returns, decide approvals and edit outgoing email in place, attach documents and photos (including from the camera), see maps, share their location with everyone in the project, read recent rooms offline, and get approvals and important-email alerts pushed to them.",
        implementationSignals: [
            "android/app/src/main/java/app/oddjob/crew/data/OddjobApi.kt",
            "android/app/src/main/java/app/oddjob/crew/data/RoomState.kt",
            "android/app/src/main/java/app/oddjob/crew/forms/FormExpression.kt",
            "android/app/src/main/java/app/oddjob/crew/push/Push.kt",
            "android/app/src/main/java/app/oddjob/crew/data/WorkspaceResults.kt",
            "android/app/src/main/java/app/oddjob/crew/data/Approvals.kt",
            "android/app/src/main/java/app/oddjob/crew/data/AgentSelection.kt",
            "android/app/src/main/java/app/oddjob/crew/data/RoomCache.kt",
            "android/app/src/main/java/app/oddjob/crew/ui/cards/MapCard.kt",
            "android/app/src/main/java/app/oddjob/crew/ui/room/LocationBeacon.kt",
            "android/app/src/main/java/app/oddjob/crew/ui/room/Attachments.kt",
            "server/domain/core/notifications/fcm.service.ts",
            "server/domain/core/notifications/push.service.ts",
            "server/domain/crew/core/crew-beacon.service.ts",
            "server/domain/org/core/self-profile.service.ts",
        ],
        primarySurfaces: [
            "Android app (android/)",
            "/api/crew",
            "/api/crew/:sessionKey/stream",
            "/api/users/me",
            "/api/push/devices",
            "/api/approvals/:id",
            "/api/crew/:sessionKey/active-agents",
            "/api/crew/:sessionKey/beacon",
            "/api/crew/:sessionKey/attachments",
            "/api/crew/:sessionKey/brief",
            "/api/crew/:sessionKey/work-product",
            "/api/crew/:sessionKey/notification-context",
        ],
        hardeningFocus: [
            "form parity with the web engine, held by fixtures generated from shared/form-expression.ts",
            "a 401 inside a room confirmed against /api/user before the app signs anyone out",
            "server idle expiry respected: the app re-prompts rather than storing a password",
            "push tokens removed on sign-out and dropped when FCM reports them unregistered",
            "Gmail directive alerts reach a person through any channel they have, browser or phone (pushService.canReach)",
            "saved rooms are tied to server and account and wiped on sign-out; an unreachable server never signs the person out",
            "links and images open only on the hosts the web allowlists; a tool result cannot send the phone elsewhere",
            "a location beacon is one fix, sent only after the person confirms; nothing is tracked",
        ],
        copilotNextActions: [
            "Keep chat-form submissions identical to the web's message text so the crew reacts the same on either device.",
            "Say when a turn carries a surface the phone cannot show yet, rather than dropping it.",
            "Keep the native cards in step with the web: each Android mirror is listed in android/README.md.",
        ],
    },
    {
        id: "score-guided-walkthroughs",
        pillar: "control",
        name: "S.C.O.R.E. Guided Walkthroughs & Onboarding Engine",
        maturity: "advanced",
        buyerValue: "Self-maintaining, interactive on-screen guided walkthroughs across the 5 S.C.O.R.E. governance dimensions with keyboard accelerators, pro-tip hints, specs links, and drift detection.",
        implementationSignals: [
            "client/src/lib/tutorial-engine.ts",
            "client/src/components/ui/TutorialBubble.tsx",
            "client/src/components/ui/TutorialHost.tsx",
            "server/domain/core/ui/components/shared/CommandPalette.tsx",
            "server/domain/knowledge/ui/modules/knowledge/pages/ComponentStyleGallery.tsx",
            "server/domain/tools/v1/capabilities/discovery.ts",
            "client/src/lib/tutorial-drift.test.ts",
        ],
        primarySurfaces: [
            "/workspace/canvas",
            "/launchpad",
            "/operations",
            "/platform-maintenance/components",
        ],
        hardeningFocus: [
            "static drift gate ensuring 100% component file and test ID presence",
            "closed-loop outcome calibration emitting >= 9.5 telemetry scores",
            "zero-layout-shift viewport boundary clamping and auto-flipping",
            "frictionless URL query parameter deep-linking with clean history replacement",
        ],
        copilotNextActions: [
            "Launch an interactive guided tour on screen for the user via launch_score_tutorial.",
            "Deep link to relevant component specs and style gallery blueprints.",
            "Verify tutorial playlist integrity and DOM selector targets via npm run test:drift.",
        ],
    },
];

export const ODDJOB_COPILOT_GUIDE: OddjobCopilotGuide = {
    operatingMode: "Act as an operations officer for governed autonomous work: discover real objects, propose safe actions, ask for approval before writes, and leave replayable evidence.",
    firstRunPrompt: "I can help you run a governed mission, inspect blocked work, attach knowledge, review approvals, replay computer-use actions, or turn repeated work into a Forge app.",
    defaultObjectTypes: ["Mission", "Job", "Pipeline", "Dataset"],
    guidedFlows: [
        "governed-support-triage",
        "computer-use-with-replay",
        "forge-internal-ops-app",
    ],
    commands: [
        {
            id: "inspect-operational-state",
            label: "Inspect Operational State",
            pillar: "missions",
            riskLevel: "low",
            requiresApproval: false,
            intent: "List real ontology-backed work objects and summarize what needs attention.",
            suggestedTools: ["ontology_list_object_types", "ontology_list_objects", "list_missions", "list_failed_jobs"],
            userFacingResult: "A concise status brief with blocked missions, failed jobs, pending approvals, and recommended next actions.",
        },
        {
            id: "start-guided-mission",
            label: "Start Guided Mission",
            pillar: "missions",
            riskLevel: "medium",
            requiresApproval: false,
            intent: "Create or prepare a first mission using a canonical guided flow.",
            suggestedTools: ["propose_mission", "search_knowledge_base", "ontology_list_objects"],
            userFacingResult: "A mission objective, needed context, risk notes, and the first approval checkpoint.",
        },
        {
            id: "review-governed-action",
            label: "Review Governed Action",
            pillar: "control",
            riskLevel: "high",
            requiresApproval: true,
            intent: "Explain a proposed write or external action before execution.",
            suggestedTools: ["ontology_execute_action", "get_system_health"],
            userFacingResult: "Affected object, action parameters, risk level, approval requirement, and reject/approve consequences.",
        },
        {
            id: "replay-computer-use",
            label: "Replay Computer Use",
            pillar: "control",
            riskLevel: "medium",
            requiresApproval: false,
            intent: "Inspect a computer-use task's observation, proposed action, execution, verification, and redactions.",
            suggestedTools: ["trycua_create_session", "trycua_observe", "trycua_screenshot"],
            userFacingResult: "A replayable step trail with confidence, screenshots or observations, and redacted sensitive inputs.",
        },
        {
            id: "forge-recurring-work",
            label: "Forge Recurring Work",
            pillar: "forge",
            riskLevel: "medium",
            requiresApproval: true,
            intent: "Convert repeated mission patterns into a durable internal app.",
            suggestedTools: ["forge_trigger", "forge_validate_workspace", "diagnose_forge_job"],
            userFacingResult: "An app proposal, validation checklist, readiness state, and publish approval point.",
        },
        {
            id: "check-knowledge-confidence",
            label: "Check Knowledge Confidence",
            pillar: "knowledge",
            riskLevel: "low",
            requiresApproval: false,
            intent: "Verify source provenance, recency, and contradictions before Copilot acts.",
            suggestedTools: ["search_knowledge_base", "search_documents", "ontology_get_object"],
            userFacingResult: "Evidence summary with source names, confidence notes, stale/conflicting source warnings, and safe next step.",
        },
        {
            id: "launch-guided-walkthrough",
            label: "Launch Guided Walkthrough",
            pillar: "control",
            riskLevel: "low",
            requiresApproval: false,
            intent: "Launch an interactive, step-by-step S.C.O.R.E. guided walkthrough on screen.",
            suggestedTools: ["launch_score_tutorial", "list_available_mcp_capabilities"],
            userFacingResult: "An interactive on-screen walkthrough with spotlights, keyboard shortcuts, pro tips, and deep links.",
        },
    ],
    trustQuestions: [
        {
            id: "why-this-action",
            question: "Why did you choose this action?",
            answerShouldInclude: ["mission objective", "available tools or ontology actions", "risk level", "evidence used"],
        },
        {
            id: "what-changes",
            question: "What will change if I approve this?",
            answerShouldInclude: ["affected object", "side effects", "approval log", "rollback or rejection behavior"],
        },
        {
            id: "what-sources",
            question: "What sources did you rely on?",
            answerShouldInclude: ["knowledge source names", "retrieval confidence", "recency", "contradictions or gaps"],
        },
        {
            id: "can-replay",
            question: "Can this be replayed or audited later?",
            answerShouldInclude: ["dynamic trace", "approval decision", "tool calls", "computer-use replay if applicable"],
        },
    ],
};

export const ODDJOB_CANONICAL_DEMOS: OddjobCanonicalDemo[] = [
    {
        id: "governed-support-triage",
        title: "Governed Support Triage",
        buyerQuestion: "Can Oddjob handle a real operational queue without letting agents act recklessly?",
        outcome: "A mission classifies a support issue, retrieves policy context, proposes an action, and pauses for approval before external commitment.",
        capabilityIds: ["durable-missions", "knowledge-grounding", "governed-approvals"],
        setupNotes: [
            "Seed a support ticket fixture.",
            "Attach a support policy document to Knowledge Store.",
            "Run a governed mission with approval required for external messages.",
        ],
        successCriteria: [
            "mission is created in under 10 minutes",
            "policy source is visible in the result",
            "approval timeline shows proposed action and human decision",
        ],
        guidedPrompt: "Classify this support issue, retrieve relevant policy, propose the safest response, and request approval before sending anything externally. Customer cannot complete payment after three retries and asks whether support can manually retry the transaction.",
    },
    {
        id: "forge-internal-ops-app",
        title: "Generate An Internal Ops App",
        buyerQuestion: "Can Oddjob create the app needed to operate recurring work?",
        outcome: "App Forge creates a small internal console, runs validation, and exposes deployment readiness.",
        capabilityIds: ["app-forge", "durable-missions", "governed-approvals"],
        setupNotes: [
            "Use a standard internal request portal prompt.",
            "Run Forge planning, generation, QA, and publish review.",
            "Review the generated app readiness checklist.",
        ],
        successCriteria: [
            "generated app has a visible working first screen",
            "QA result is recorded",
            "publish requires explicit approval",
        ],
        guidedPrompt: "Build a small internal request portal for support escalations with status, priority, owner, notes, and approval history. Run validation and require approval before publish.",
    },
    {
        id: "computer-use-with-replay",
        title: "Computer Use With Replay",
        buyerQuestion: "Can an agent safely operate a GUI when no API exists?",
        outcome: "A Trycua computer-use task observes a session, proposes a grounded action, waits for confirmation, executes, verifies, and stores replay steps.",
        capabilityIds: ["computer-use-replay", "governed-approvals"],
        setupNotes: [
            "Enable Trycua for the test organization.",
            "Create a mock or sandbox session.",
            "Create a computer-use task with requireConfirmation enabled.",
        ],
        successCriteria: [
            "task enters needs_confirmation before execution",
            "target grounding method and confidence are visible before approval",
            "typed text is redacted in replay",
            "verification observation is stored after confirmation",
        ],
        guidedPrompt: "Create a governed computer-use mission that observes a sandbox GUI task, proposes a grounded action, waits for confirmation, executes only after approval, verifies the result, and stores replay evidence.",
    },
    {
        id: "plan-run-recover",
        title: "Plan, Run, Recover",
        buyerQuestion: "Can Oddjob plan real multi-step work, run it under the right strategy, and survive a mid-run failure without losing progress?",
        outcome: "An objective is compiled into a reviewable plan with dependencies and estimates, runs wave by wave, absorbs an injected tool failure via a named rescue strategy, and resumes from persisted state instead of restarting.",
        capabilityIds: [
            "adaptive-planning",
            "multi-strategy-execution",
            "resilient-execution",
            "durable-missions",
        ],
        setupNotes: [
            "Create a mission with executionStrategy set to rolling_wave and a small dynamicCycleBudgetLimitUsd.",
            "Review the generated plan — steps, dependency graph, and cost/duration estimates — before approving execution.",
            "Point one step at a tool that fails on first call so recovery is exercised rather than described.",
            "Interrupt the run after the first wave completes, then resume it.",
        ],
        successCriteria: [
            // Each criterion maps to one capability under test, so a partial
            // pass identifies which layer regressed rather than just "demo failed".
            "the plan is reviewable before any step executes, and lists steps, dependencies, and estimates",
            "the run records executionStrategy rolling_wave and advances one wave at a time",
            "the injected failure produces a named rescue strategy (retry, relax, skip, or replan) in the run timeline",
            "resume continues from persisted blackboard state — already-completed waves are not re-run",
            "the run halts on the cycle budget limit rather than silently degrading output quality",
        ],
        guidedPrompt: "Plan a multi-step migration of our onboarding checklist into a tracked workstream: research the current steps, draft the new structure, and produce a rollout plan. Show me the plan with dependencies and cost estimates before running anything. Run it as rolling waves with a $2 cycle budget, and if a step fails, tell me which rescue strategy you applied and what it changed.",
    },
    {
        id: "score-guided-platform-tour",
        title: "S.C.O.R.E. Guided Platform Tour",
        buyerQuestion: "How do operators and developers learn Oddjob's governed workflow without cognitive overload?",
        outcome: "An interactive on-screen tour highlights each of the 5 S.C.O.R.E. dimensions with live spotlights, shortcuts, pro tips, and calibrated outcome telemetry.",
        capabilityIds: ["score-guided-walkthroughs", "governed-approvals"],
        setupNotes: [
            "Open Command Palette (⌘K) and select a tour, or invoke via Copilot chat.",
            "Step through Scope, Continuity, Outcome, Reliability, and Eulerian dimensions.",
            "Verify telemetry completion event and calibrated outcome score.",
        ],
        successCriteria: [
            "walkthrough mounts without layout shift and positions relative to live DOM elements",
            "step navigation completes and records calibrated outcome score >= 9.5",
        ],
        guidedPrompt: "Show me how Oddjob works across the 5 S.C.O.R.E. dimensions. Start a guided walkthrough of the platform.",
    },
    {
        id: "spatial-precision-gated-rules",
        title: "Precision-Gated Spatial Rules",
        buyerQuestion: "Can Oddjob act on where assets actually are — without mistaking an unknown position for a known one?",
        outcome: "Location-bearing signals resolve to H3 cells with provenance, geofence membership is evaluated per fix, and a rule armed on the feed fires only on definite positions — a low-precision fix reads as undetermined, never as inside or outside.",
        capabilityIds: ["spatial-signals"],
        setupNotes: [
            "Seed a signal feed fixture containing at least one high-precision fix, one definite out-of-zone fix, and one coarse fix (e.g. a country centroid).",
            "Configure a geofence and a rule suite over the feed.",
            "Arm the rule and walk the feed through ingestion.",
        ],
        successCriteria: [
            "each resolved signal shows its positional precision and provenance before any rule verdict",
            "the coarse fix is reported as undetermined — it is never counted as inside or outside the geofence",
            "the armed rule fires only on definite membership, and the verdict trail shows which signals were excluded by the precision gate",
        ],
        guidedPrompt: "Track our field assets against the downtown service geofence. Ingest this signal feed and show me which assets are definitely inside the zone, which are definitely outside, and which are undetermined because their fix is too coarse — then arm the exclusion rule and show me exactly which signals it would act on and why.",
    },
    {
        id: "crew-deliberation-writeback",
        title: "Crew Deliberation With Knowledge Write-Back",
        buyerQuestion: "Can a room of specialist agents deliberate on a contested question and leave durable, inspectable output?",
        outcome: "A crew room recruits the agents relevant to the question, deliberates across rounds, records where the room agreed and where it split, concludes with a closing brief, and writes the ratified conclusions back into organizational knowledge.",
        capabilityIds: ["crew-collaboration", "knowledge-grounding"],
        setupNotes: [
            "Open a crew room in a project space with at least two agent cards whose specialties differ.",
            "Pose a question with a genuinely contested answer so consensus has to be earned rather than declared.",
            "Conclude the room and inspect the closing brief and the knowledge write-back.",
        ],
        successCriteria: [
            "the recruited speakers match the question's specialties, and the room says plainly when no relevant agent exists",
            "the closing brief records agreement and dissent as separate entries with the speakers who held each position",
            "ratified conclusions land in the knowledge store and are linked back to the room that produced them",
        ],
        guidedPrompt: "Open a crew room on whether we should retry failed payment webhooks with exponential backoff or park them in a dead-letter queue for manual review. Recruit the relevant specialists, let them deliberate, then show me where they agreed, where they split, and what was written to the knowledge base.",
    },
    {
        id: "formal-layout-proof",
        title: "Formal Layout & Governance Proof",
        buyerQuestion: "Can Oddjob prove — not just spot-check — that a generated layout holds at every width and that a workflow cannot bypass its approval gate?",
        outcome: "Layout invariants are proven across the continuous viewport spectrum, a responsive clamp() expression is synthesized for the constrained dimension, and the governance guard returns a machine-checkable verdict that the workflow graph cannot reach a write action without passing its approval node.",
        capabilityIds: ["formal-layout-and-governance-verification", "app-forge"],
        setupNotes: [
            "Open a scaffolded workspace or canvas containing a generated app layout.",
            "Run layout verification against it via /api/scaffold or /api/qa.",
            "Run the governance guard over a workflow graph that contains an approval-gated write.",
        ],
        successCriteria: [
            "the verifier returns a machine-checkable verdict on the layout invariants — sat/unsat with the violating interval — not a visual pass/fail",
            "a synthesized clamp() expression is emitted for at least one constrained dimension rather than a fixed breakpoint",
            "the governance verdict demonstrates the workflow graph cannot bypass its approval node to reach a write action",
        ],
        guidedPrompt: "Formally verify this generated dashboard layout across the mobile-to-desktop viewport spectrum. Prove the grid cannot overflow its container at any width, synthesize the responsive clamp() for the sidebar, and show me the proof that the publish workflow cannot bypass its approval node.",
    },
    {
        id: "presentation-crew-deck",
        title: "Presentation Crew Deck From Raw Markdown",
        buyerQuestion: "Can Oddjob turn raw text into a designed presentation without me touching a slide tool?",
        outcome: "Raw markdown is distilled into a DocumentBlockAST by the creative crew — hero, content slides, stat callouts — themed within the design system, contrast-checked, and held for approval before publish.",
        capabilityIds: ["presentation-crew-layout", "governed-approvals"],
        setupNotes: [
            "Supply a source document or project context with real content — not lorem ipsum.",
            "Orchestrate the presentation crew over it from /workspace/chat or /api/presentation-crew/orchestrate.",
            "Review the assembled deck before approving publish.",
        ],
        successCriteria: [
            "the output is a structured block AST — hero_header, slide_frame, stat_callout — not pasted paragraphs",
            "the creative crew's roles leave visible, distinct contributions across layout, theme, data story, and brand",
            "contrast violations are flagged before publish, and publish waits on explicit approval",
        ],
        guidedPrompt: "Turn this product-update markdown into an executive brief deck: a hero slide, three content slides, a stats callout, and a closing slide. Run the creative crew, keep it on the design system, and show me the contrast check before I approve publish.",
    },
    {
        id: "scribe-critic-loop",
        title: "Scribe Studio Draft, Critique, Export",
        buyerQuestion: "Can Oddjob help me draft and rigorously critique a real document — not just chat about one?",
        outcome: "A document is drafted on Scribe Studio's station spine, audited by critic lenses whose findings anchor to the passage they judge, accepted findings are applied as edits, and the result exports to DOCX, PDF, or Markdown.",
        capabilityIds: ["scribe-studio"],
        setupNotes: [
            "Open Scribe Studio with an outline or existing draft.",
            "Run the critic lenses over the manuscript.",
            "Accept a subset of findings and export the document.",
        ],
        successCriteria: [
            "critic findings anchor to the passage they judge, and a finding retires when its passage no longer exists",
            "accepting a finding produces an applied edit in the manuscript, not just advice in the rail",
            "the manuscript exports cleanly in at least one of DOCX, PDF, or Markdown",
        ],
        guidedPrompt: "Open Scribe Studio and draft a two-page vendor evaluation from this outline. Run the critic lenses over it, show me the findings anchored to their passages, apply the ones I accept, and export the result to DOCX.",
    },
];

export const ODDJOB_READINESS_CHECKS: OddjobReadinessCheck[] = [
    {
        id: "tutorial-drift-valid",
        label: "S.C.O.R.E. tutorial selector drift and playlist integrity hold",
        pillar: "control",
        priority: "p0",
        command: "npm run test:drift",
        expected: "All tutorial snippets map to existing source files with valid data-tour attributes, non-empty targets, and unbroken chained playlists.",
    },
    {
        id: "spatial-predicate-engine-valid",
        label: "Spatial predicate engine and precision gate hold",
        pillar: "spatial",
        priority: "p0",
        command: "npx vitest run server/domain/signal-intelligence/core/spatial-predicate-engine.service.test.ts",
        expected: "Comparison operators evaluate rather than silently no-op, and a low-precision position never resolves as a definite location.",
    },
    {
        id: "spatial-stream-valid",
        label: "Spatial signal stream validates",
        pillar: "spatial",
        priority: "p1",
        command: "npm run smoke:spatial-stream",
        expected: "Location-bearing signals flow through ingestion to H3 resolution without dropping positional provenance.",
    },
    {
        id: "forge-readiness-gate-valid",
        label: "App publish-readiness gate passes ready workspaces and rejects broken ones",
        pillar: "forge",
        priority: "p0",
        command: "npx vitest run server/domain/apps/tests/unit/app_readiness.service.test.ts",
        expected: "The readiness checklist marks a complete workspace ready and fails one missing build scripts or an entrypoint, naming what is absent.",
    },
    {
        id: "forge-gallery-conformance-valid",
        label: "Generated-app visual QA gate enforces Component Gallery conformance",
        pillar: "forge",
        priority: "p1",
        command: "npx vitest run server/domain/apps/tests/unit/forge_gallery_conformance.test.ts",
        expected: "The Forge validator flags generated UI assembled without gallery imports, suggests the gallery component to use instead, and never fails a build on findings alone.",
    },
    {
        id: "knowledge-graph-rag-valid",
        label: "Graph-RAG hierarchical retrieval holds tenant boundaries",
        pillar: "knowledge",
        priority: "p0",
        command: "npx vitest run server/domain/knowledge/core/graph/hierarchical-retrieval.service.test.ts",
        expected: "Hierarchical retrieval returns community summaries scoped to the requesting organization, null-org queries read only public rows, and failed hierarchy builds are evicted rather than cached.",
    },
    {
        id: "capability-manifest-valid",
        label: "Capability manifest validates",
        pillar: "control",
        priority: "p0",
        command: "npm run smoke:capabilities",
        expected: "All pillar, capability, demo, and readiness IDs are unique and internally consistent.",
    },
    {
        id: "autonomy-policy-valid",
        label: "Shared autonomy policy validates",
        pillar: "control",
        priority: "p0",
        command: "npm run smoke:autonomy-policy",
        expected: "Canonical safe, review, and blocked autonomy cases classify consistently.",
    },
    {
        id: "trycua-focused-typecheck",
        label: "Computer-use TypeScript surface has no focused errors",
        pillar: "control",
        priority: "p0",
        command: "npx tsc --noEmit --pretty false --project tsconfig.server.json",
        expected: "No Trycua/computer-use related TypeScript errors.",
    },
    {
        id: "first-mission-demo-path",
        label: "Governed mission fixture contract validates",
        pillar: "missions",
        priority: "p1",
        command: "npm run smoke:golden-path",
        expected:
            "The governed support-triage fixture validates and the shared autonomy policy still classifies its external commitment as review with the required policy flag. " +
            "This is a deterministic contract check over a fixture: it does not create, pause, or resume a real mission, and the timeline and replay evidence it prints are derived from the fixture rather than from an execution. " +
            "See docs/guides/first-mission-in-10-minutes.md Path A for the end-to-end mission walkthrough.",
    },
];

export function getOddjobCapabilityManifest() {
    return {
        positioning: ODDJOB_POSITIONING,
        pillars: ODDJOB_PILLARS,
        capabilities: ODDJOB_CAPABILITIES,
        canonicalDemos: ODDJOB_CANONICAL_DEMOS,
        readinessChecks: ODDJOB_READINESS_CHECKS,
        copilotGuide: ODDJOB_COPILOT_GUIDE,
    };
}
