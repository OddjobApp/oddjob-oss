import {
    parseCapabilityManifest,
    type CapabilityManifest,
} from "../schema/capabilities/manifest.js";

/**
 * Maps the buyer-facing product capability ids to executable ACDD contract ids.
 * Product ids remain URL-oriented kebab case; executable ids use the manifest's
 * stable lowercase snake-case convention.
 */
export const PRODUCT_TO_EXECUTABLE_CAPABILITY_ID = {
    "durable-missions": "durable_missions",
    "governed-approvals": "governed_approvals",
    "computer-use-replay": "computer_use_replay",
    "app-forge": "app_forge",
    "knowledge-grounding": "knowledge_grounding",
    "prediction-intelligence": "prediction_intelligence",
    "spatial-signals": "spatial_signals",
    "crew-collaboration": "crew_collaboration",
    "adaptive-planning": "adaptive_planning",
    "multi-strategy-execution": "multi_strategy_execution",
    "resilient-execution": "resilient_execution",
    "scribe-studio": "scribe_studio",
    "formal-layout-and-governance-verification": "formal_layout_and_governance_verification",
    "presentation-crew-layout": "presentation_crew_layout",
    "score-guided-walkthroughs": "score_guided_walkthroughs",
    "crew-mobile": "crew_mobile",
} as const;

const definitions: unknown[] = [
    {
        schema_version: 1,
        capability_version: "1.0.0",
        capability_id: "durable_missions",
        metadata: {
            display_name: "Durable Missions",
            category: "Custom JIT",
            description: "Turn operational objectives into durable, governed work that can plan, delegate, pause, resume, retry, and report progress.",
            owner: "Mission Platform",
        },
        technical_spec: {
            inputs: {
                objective: "string",
                constraints: "string[]",
                context: "object",
                approval_policy: "string | null",
            },
            outputs: {
                mission_id: "integer",
                status: "string",
                plan: "object",
                result: "object | null",
            },
        },
        documentation_meta: {
            summary: "Creates a durable mission record and coordinates its governed execution through completion, suspension, or failure.",
            business_use_cases: [
                "Run long-lived operational work that spans multiple agents and tools.",
                "Pause work for human input and resume from persisted state.",
                "Recover and retry failed mission steps without losing execution history.",
            ],
            guardrails: [
                "Actions inherit organization policy, budget, credential, and approval constraints.",
                "High-impact steps must pause when the applicable approval policy requires human review.",
                "Mission state and execution events must remain organization-scoped and auditable.",
            ],
        },
        runtime_context: {
            risk_profile: "High",
            execution_environment: "Host",
            dependencies: ["mission", "agents", "governor", "knowledge", "jobs"],
        },
    },
    {
        schema_version: 1,
        capability_version: "1.0.0",
        capability_id: "governed_approvals",
        metadata: {
            display_name: "Governed Approvals",
            category: "System Utilities",
            description: "Evaluate proposed autonomous actions against policy and route review-required actions to authorized human approvers.",
            owner: "Governance Platform",
        },
        technical_spec: {
            inputs: {
                action: "object",
                actor: "object",
                risk_context: "object",
                policy_scope: "string",
            },
            outputs: {
                decision: "allow | review | deny",
                approval_request_id: "integer | null",
                reasons: "string[]",
                audit_reference: "string",
            },
        },
        documentation_meta: {
            summary: "Provides a consistent decision and human-review boundary for consequential agent and workflow actions.",
            business_use_cases: [
                "Require approval before an agent sends an external message or changes a production system.",
                "Apply organization policy consistently across missions, agents, tools, and generated apps.",
                "Produce an auditable record of the evidence and authority behind a decision.",
            ],
            guardrails: [
                "Only authorized approvers may resolve an approval request.",
                "Denied or expired approvals must not execute the underlying action.",
                "Policy inputs, decisions, reasons, and resolution identity must be retained for audit.",
            ],
        },
        runtime_context: {
            risk_profile: "Medium",
            execution_environment: "Host",
            dependencies: ["governor", "approval_requests", "audit", "auth"],
        },
    },
    {
        schema_version: 1,
        capability_version: "1.0.0",
        capability_id: "computer_use_replay",
        metadata: {
            display_name: "Computer Use With Replay",
            category: "Browser Automation",
            description: "Observe and operate a computer session through governed actions while preserving a replayable execution trace.",
            owner: "Computer Intelligence",
        },
        technical_spec: {
            inputs: {
                objective: "string",
                session_id: "string | null",
                allowed_actions: "string[]",
                approval_policy: "string | null",
            },
            outputs: {
                session_id: "string",
                task_id: "integer",
                status: "string",
                replay_events: "object[]",
                artifacts: "object[]",
            },
        },
        documentation_meta: {
            summary: "Provides a controlled fallback for systems without suitable APIs and records observations and actions for inspection and replay.",
            business_use_cases: [
                "Complete operational work in legacy or browser-only systems.",
                "Replay and inspect the sequence of computer actions taken by an agent.",
                "Pause sensitive UI actions for human confirmation.",
            ],
            guardrails: [
                "Computer-use sessions must run in the configured isolated environment.",
                "Credential entry, destructive actions, and external submissions must obey approval policy.",
                "Session recordings and artifacts must respect organization data-retention and redaction policy.",
            ],
        },
        runtime_context: {
            risk_profile: "High",
            execution_environment: "Ephemeral Sandbox",
            dependencies: ["trycua", "governor", "credentials", "audit"],
        },
    },
    {
        schema_version: 1,
        capability_version: "1.0.0",
        capability_id: "app_forge",
        metadata: {
            display_name: "App Forge",
            category: "Custom JIT",
            description: "Plan, generate, validate, deploy, and evolve an operational application from a governed product brief.",
            owner: "App Platform",
        },
        technical_spec: {
            inputs: {
                product_brief: "object",
                data_contracts: "object[]",
                design_constraints: "object",
                deployment_target: "string",
            },
            outputs: {
                app_id: "integer",
                version_id: "integer",
                validation_report: "object",
                deployment: "object | null",
            },
        },
        documentation_meta: {
            summary: "Turns recurring operational work into a durable internal application with traceable generation, validation, versioning, and deployment.",
            business_use_cases: [
                "Generate an internal workflow application from a structured operational need.",
                "Validate generated code and configuration before deployment.",
                "Evolve an existing generated application through versioned changes.",
            ],
            guardrails: [
                "Generated artifacts must pass configured validation and security checks before deployment.",
                "Production deployment requires the authority and approval configured for the target environment.",
                "Generated applications must preserve organization isolation and declared data contracts.",
            ],
        },
        runtime_context: {
            risk_profile: "High",
            execution_environment: "Isolated Docker Container",
            dependencies: ["apps", "generation", "blueprints", "governor", "deployments"],
        },
    },
    {
        schema_version: 1,
        capability_version: "1.0.0",
        capability_id: "knowledge_grounding",
        metadata: {
            display_name: "Knowledge Grounding",
            category: "Knowledge",
            description: "Retrieve organization-scoped evidence and context that grounds agent, mission, and application decisions.",
            owner: "Knowledge Platform",
        },
        technical_spec: {
            inputs: {
                query: "string",
                scope: "object",
                limit: "integer",
                minimum_relevance: "number | null",
            },
            outputs: {
                evidence: "object[]",
                citations: "object[]",
                graph_context: "object | null",
                retrieval_metadata: "object",
            },
        },
        documentation_meta: {
            summary: "Combines stored documents, semantic retrieval, graph context, and mission memory into attributable evidence for execution.",
            business_use_cases: [
                "Ground an agent response in approved organizational knowledge.",
                "Retrieve prior mission context and reusable execution evidence.",
                "Provide citations and provenance for decisions and generated outputs.",
            ],
            guardrails: [
                "Retrieval must enforce organization and resource-level access boundaries.",
                "Evidence must retain source provenance and must not be represented as more authoritative than its source.",
                "Sensitive content must follow applicable redaction, retention, and data-use policy.",
            ],
        },
        runtime_context: {
            risk_profile: "Medium",
            execution_environment: "Host",
            dependencies: ["knowledge", "qdrant", "graph_rag", "auth"],
        },
    },
    {
        schema_version: 1,
        capability_version: "0.1.0",
        capability_id: "prediction_intelligence",
        metadata: {
            display_name: "Prediction Intelligence",
            category: "Knowledge",
            description: "Generate governed predictions with explicit context, confidence, alternatives, and evidence for operational decision support.",
            owner: "Prediction Intelligence",
        },
        technical_spec: {
            inputs: {
                prediction_question: "string",
                context: "object",
                horizon: "string | null",
                policy_scope: "string",
            },
            outputs: {
                prediction: "object",
                confidence: "number",
                alternatives: "object[]",
                explanation: "object",
                governance_decision: "object",
            },
        },
        documentation_meta: {
            summary: "Produces experimental operational forecasts while preserving uncertainty, provenance, governance decisions, and later outcome calibration.",
            business_use_cases: [
                "Estimate likely operational outcomes and surface alternative scenarios.",
                "Prioritize intervention based on risk and confidence.",
                "Compare predictions with observed outcomes to improve calibration.",
            ],
            guardrails: [
                "Predictions are decision support and must not be presented as certain outcomes.",
                "Low-confidence, sensitive, or high-impact predictions must be gated by policy.",
                "Inputs, explanations, governance decisions, and observed outcomes must be retained for evaluation.",
            ],
        },
        runtime_context: {
            risk_profile: "Medium",
            execution_environment: "Host",
            dependencies: ["prediction_intelligence", "knowledge", "governance", "calibration"],
        },
    },
    {
        schema_version: 1,
        capability_version: "0.1.0",
        capability_id: "spatial_signals",
        metadata: {
            display_name: "Spatial Signal Intelligence",
            category: "Data Operations",
            description: "Resolve location-bearing signals into H3 hex cells and geofences, and evaluate spatial rules over where assets actually are.",
            owner: "Signal Intelligence",
        },
        technical_spec: {
            inputs: {
                signal: "object",
                position: "object | null",
                position_precision: "string",
                geofence_scope: "string | null",
                rule_suite_id: "integer | null",
            },
            outputs: {
                h3_cells: "string[]",
                geofence_matches: "object[]",
                rule_decisions: "object[]",
                position_confidence: "string",
            },
        },
        documentation_meta: {
            summary: "Turns positional signals into queryable spatial context and rule decisions, while keeping the precision behind every fix explicit.",
            business_use_cases: [
                "Aggregate location-bearing events into H3 cells for spatial analysis.",
                "Evaluate geofence membership for operational rules and alerting.",
                "Drive spatial rule suites over live signal feeds.",
            ],
            guardrails: [
                // Encodes the failure this capability must never repeat: a
                // country-centroid fix reads as a definite position and fires
                // exclusion rules against assets that are merely unlocated.
                "An unknown or low-precision position must never be evaluated as a definite location.",
                "Exclusion rules must not fire on assets whose position is undetermined.",
                "The positional precision and resolution behind each fix must remain inspectable.",
                "Spatial decisions must remain organization-scoped and auditable.",
            ],
        },
        runtime_context: {
            risk_profile: "High",
            execution_environment: "Host",
            dependencies: ["signal_intelligence", "knowledge", "kafka", "governance"],
        },
    },
    {
        schema_version: 1,
        capability_version: "0.1.0",
        capability_id: "crew_collaboration",
        metadata: {
            display_name: "CREW Multi-Agent Collaboration",
            category: "Collaboration",
            description: "Convene a room of specialist agents to deliberate on a problem, reach consensus, and write validated conclusions back to organizational knowledge.",
            owner: "Crew Platform",
        },
        technical_spec: {
            inputs: {
                message: "string",
                session_key: "string | null",
                project_scope: "string",
                participants: "string[] | null",
            },
            outputs: {
                session_key: "string",
                turns: "object[]",
                consensus: "object",
                knowledge_written: "object[]",
            },
        },
        documentation_meta: {
            summary: "Runs a governed multi-agent deliberation with streamed turns, recruiting only relevant participants and recording what the room concluded.",
            business_use_cases: [
                "Get multiple specialist perspectives on an operational decision.",
                "Capture where a group of agents agreed and where they diverged.",
                "Promote validated conclusions into reusable organizational knowledge.",
            ],
            guardrails: [
                // The concrete leak this must prevent: crew recall without
                // project scoping surfaced private-project content.
                "Every crew read path must be project-scoped so private work cannot surface across projects.",
                "Agents must be recruited on relevance, and the room must return none rather than an irrelevant panel.",
                "Write-back to knowledge must require a consensus threshold rather than a single agent's assertion.",
                "Crew sessions and their conclusions must remain organization-scoped and auditable.",
            ],
        },
        runtime_context: {
            risk_profile: "Medium",
            execution_environment: "Host",
            dependencies: ["crew", "agents", "knowledge", "projects", "governance"],
        },
    },
    {
        schema_version: 1,
        capability_version: "1.0.0",
        capability_id: "adaptive_planning",
        metadata: {
            display_name: "Adaptive Planning",
            category: "Custom JIT",
            description: "Compile an operational objective into a structured, reviewable plan of steps, tool affordances, dependencies, and cost and duration estimates.",
            owner: "Mission Platform",
        },
        technical_spec: {
            inputs: {
                objective: "string",
                constraints: "string[]",
                available_tools: "string[]",
                prior_run_history: "object | null",
            },
            outputs: {
                plan: "object",
                steps: "object[]",
                dependency_graph: "object",
                estimates: "object",
                unmet_requirements: "string[]",
            },
        },
        documentation_meta: {
            summary: "Produces a plan a human can review before execution, including what the plan cannot satisfy with the tools available.",
            business_use_cases: [
                "Turn an ambiguous objective into named, orderable steps.",
                "Estimate cost and duration before committing budget to a run.",
                "Replan around a failed step without discarding completed work.",
            ],
            guardrails: [
                "A plan must not reference a capability the caller is not permitted to invoke.",
                "Estimates must be presented as estimates, and flagged when uncalibrated against observed runs.",
                "Replanning must preserve completed work and record what changed and why.",
            ],
        },
        runtime_context: {
            risk_profile: "Medium",
            execution_environment: "Host",
            dependencies: ["mission", "pipeline", "agents", "knowledge"],
        },
    },
    {
        schema_version: 1,
        capability_version: "1.0.0",
        capability_id: "multi_strategy_execution",
        metadata: {
            display_name: "Multi-Strategy Execution",
            category: "Control Flow",
            description: "Run a mission under the execution strategy matching its shape — pre-planned, dynamic autonomous, rolling wave, parallel fan-out, reactive, or human-driven.",
            owner: "Mission Platform",
        },
        technical_spec: {
            inputs: {
                mission_id: "integer",
                execution_strategy: "string",
                blackboard: "object",
                cycle_budget_limit_usd: "string | null",
            },
            outputs: {
                run_id: "integer",
                status: "string",
                completed_steps: "object[]",
                resume_condition: "object | null",
            },
        },
        documentation_meta: {
            summary: "Dispatches a mission to the orchestrator for its declared strategy and maintains consistent pause, resume, and cancel semantics across all of them.",
            business_use_cases: [
                "Run fully autonomous work where the path is not known in advance.",
                "Gate every action on human approval for sensitive objectives.",
                "Wake dormant work only when an external event arrives.",
            ],
            guardrails: [
                // The strategy field is unvalidated free text today; a bad value
                // must fail loudly rather than silently fall through to a default.
                "An unrecognized execution strategy must fail explicitly rather than defaulting to autonomous execution.",
                "human_driven must not execute an action before its approval is recorded.",
                "Every strategy must honour the mission's cycle budget limit.",
                "Pause, resume, and cancel must behave identically regardless of strategy.",
            ],
        },
        runtime_context: {
            risk_profile: "High",
            execution_environment: "Host",
            dependencies: ["mission", "agents", "governor", "jobs"],
        },
    },
    {
        schema_version: 1,
        capability_version: "1.0.0",
        capability_id: "resilient_execution",
        metadata: {
            display_name: "Resilient Execution",
            category: "System Utilities",
            description: "Keep long-running work alive through transient failure with retry, circuit breaking, pattern-based self-healing, and escalation of what cannot be repaired.",
            owner: "Mission Platform",
        },
        technical_spec: {
            inputs: {
                run_id: "integer",
                failure: "object",
                attempt: "integer",
                budget_remaining_usd: "string | null",
            },
            outputs: {
                rescue_strategy: "retry | relax | skip | replan | escalate",
                applied: "boolean",
                circuit_state: "string",
                escalation_id: "integer | null",
            },
        },
        documentation_meta: {
            summary: "Selects and applies a recovery strategy for a failed step, or escalates to a human when the failure is novel or the budget is exhausted.",
            business_use_cases: [
                "Survive transient tool and network failures without losing mission state.",
                "Stop hammering a failing external system by opening a circuit.",
                "Escalate a novel failure to a human with the evidence needed to act.",
            ],
            guardrails: [
                "Recovery must never silently mask a failure an operator needed to see.",
                "Repeated self-healing on the same step must surface as a signal, not be treated as success.",
                "Budget and SLA guards must halt work rather than silently degrade output quality.",
                "Escalation must reach a human before a mission exhausts its budget.",
            ],
        },
        runtime_context: {
            risk_profile: "High",
            execution_environment: "Host",
            dependencies: ["mission", "governor", "jobs", "approvals"],
        },
    },
    {
        schema_version: 1,
        capability_version: "1.0.0",
        capability_id: "scribe_studio",
        metadata: {
            display_name: "Scribe Studio",
            category: "Document Processing",
            description: "Nonlinear manuscript and legal drafting studio with Subway branch graphs, multi-lens persona auditing, interactive margin notes, and biometric pacing telemetry.",
            owner: "Authoring & Synthesis Platform",
        },
        technical_spec: {
            inputs: {
                sessionId: "integer",
                title: "string",
                archetypeMode: "heros_journey | story_circle | save_the_cat | saas_msa | harvard_batna | amazon_prfaq | minto_pyramid | yc_pitch_deck | imrad_paper | freeform",
                targetWordCount: "integer | null",
                lenses: "string[]",
            },
            outputs: {
                document_id: "integer",
                stations: "object[]",
                active_branch_id: "integer",
                annotations: "object[]",
                telemetry: "object",
            },
        },
        documentation_meta: {
            summary: "Manages nonlinear longform document generation, contract drafting, multi-lens critic evaluation, and forward-propagation continuity reconciliation across stations.",
            business_use_cases: [
                "Draft and negotiate enterprise B2B SaaS Master Services Agreements with AI legal auditing.",
                "Author complex product PR/FAQs and executive Minto Pyramid strategy documents.",
                "Structure and pacing fiction novels and episodic scripts using Subway Spine milestone graphs.",
                "Collaborate with specialized CREW personas through focused excerpt targeting and one-click diff applications.",
            ],
            guardrails: [
                "Branch edits must run forward-propagation continuity analysis before merging into the main trunk.",
                "High-severity legal risks and contract loopholes must flag visual conflict indicators.",
                "Multi-format compiled exports (PDF, Word DOCX, Markdown) must preserve verified station states.",
            ],
        },
        runtime_context: {
            risk_profile: "Low",
            execution_environment: "Host",
            dependencies: ["scribe", "crew", "ai", "tools"],
        },
    },
    {
        schema_version: 1,
        capability_version: "1.0.0",
        capability_id: "formal_layout_and_governance_verification",
        metadata: {
            display_name: "Formal Layout & AI Governance Verification Engine",
            category: "System Architecture",
            description: "SMT/QF_LRA layout invariant proofs across the viewport spectrum, closed-form MaxSMT clamp() synthesis, DPLL/MaxSAT pack resolution, and Horn-clause workflow safety guards.",
            owner: "Scaffold & Governance Platform",
        },
        technical_spec: {
            inputs: {
                layoutTree: "object",
                viewportBounds: "object | null",
                brandSeedHex: "string | null",
                packs: "string[]",
                workflowGraph: "object | null",
            },
            outputs: {
                proof_certificate: "object",
                synthesized_rules: "object[]",
                theme_tokens: "object",
                execution_order: "string[]",
                unsatisfiable_reason: "string | null",
            },
        },
        documentation_meta: {
            summary: "Proves geometric layout invariants continuously rather than sampling breakpoints, synthesises WCAG-compliant tokens from a seed colour, resolves pack sets by SAT, and proves a workflow cannot bypass its human-in-the-loop guards.",
            business_use_cases: [
                "Prove a generated interface cannot clip or overlap at any width between 320 and 2560 pixels.",
                "Synthesise light and dark palettes that meet WCAG 2.2 AA contrast from a single brand colour.",
                "Resolve a conflicting scaffold pack selection, or prove no valid resolution exists.",
                "Verify an agent workflow cannot reach an action that skips an approval gate.",
            ],
            guardrails: [
                "An unsatisfiable pack set fails assembly rather than falling back to an unchecked resolver.",
                "A dependency cycle is reported as unsatisfiable with the offending packs named, never as a truncated execution order.",
                "Layout proofs are solver results, not sampled measurements, and carry a certificate.",
            ],
        },
        runtime_context: {
            risk_profile: "Low",
            execution_environment: "Host",
            dependencies: ["scaffold", "governance", "mission", "tools"],
        },
    },
    {
        schema_version: 1,
        capability_version: "1.0.0",
        capability_id: "presentation_crew_layout",
        metadata: {
            display_name: "Presentation Crew & Document Layout Engine",
            category: "Document Processing",
            description: "Turns raw markdown into a structured DocumentBlockAST — decks, whitepapers, executive briefs and promotional graphics — through a four-agent creative crew.",
            owner: "Authoring & Synthesis Platform",
        },
        technical_spec: {
            inputs: {
                sourceText: "string",
                documentType: "deck | whitepaper | brief | graphic",
                themeHint: "string | null",
                organizationId: "integer",
            },
            outputs: {
                blocks: "object[]",
                theme: "object",
                media: "object[]",
                contrast_report: "object",
            },
        },
        documentation_meta: {
            summary: "Distils text into atomic document blocks, synthesises a visual theme and hero media for them, and checks the result against contrast standards before it is presented.",
            business_use_cases: [
                "Generate a presentation deck or executive brief from project context.",
                "Lay out document text into polished slides using the four-agent creative crew.",
                "Produce a whitepaper or promotional graphic from existing written material.",
            ],
            guardrails: [
                "Synthesised themes must satisfy WCAG contrast before the layout is offered.",
                "Media generation passes through the human-in-the-loop approval gates.",
            ],
        },
        runtime_context: {
            risk_profile: "Low",
            execution_environment: "Host",
            dependencies: ["crew", "knowledge", "ai"],
        },
    },
    {
        schema_version: 1,
        capability_version: "1.0.0",
        capability_id: "score_guided_walkthroughs",
        metadata: {
            display_name: "S.C.O.R.E. Guided Walkthroughs & Onboarding Engine",
            category: "Tutorials & Onboarding",
            description: "Self-maintaining on-screen guided walkthroughs across the 5 S.C.O.R.E. governance dimensions with keyboard accelerators, pro-tip hints, specs links, and drift detection.",
            owner: "Control Plane",
        },
        technical_spec: {
            inputs: {
                track_id: "string",
                start_step: "integer | null",
                auto_advance: "boolean",
            },
            outputs: {
                status: "string",
                active_step: "integer",
                calibrated_outcome: "number",
            },
        },
        documentation_meta: {
            summary: "Mounts and coordinates S.C.O.R.E. guided walkthroughs, highlighting live DOM targets and calibrating outcome telemetry.",
            business_use_cases: [
                "Step operators through high-stakes governance and rescue workflows without cognitive overload.",
                "Provide live interactive demos for all canonical components directly from the Component Style Gallery.",
                "Prevent interface and selector drift with automated CI verification gates.",
            ],
            guardrails: [
                "Read-safe idempotency ensures tours cannot mutate database records or trigger accidental executions.",
                "Auto-flipping and viewport boundary clamping prevent layout shifts or obstruction of critical UI controls.",
                "Static drift testing halts CI builds if any target selector or component file ceases to exist.",
            ],
        },
        runtime_context: {
            risk_profile: "Low",
            execution_environment: "Host",
            dependencies: ["client", "control"],
        },
    },
    {
        schema_version: 1,
        capability_version: "0.1.0",
        capability_id: "crew_mobile",
        metadata: {
            display_name: "CREW on Android",
            category: "Collaboration",
            description: "Take part in CREW rooms from a native Android app: follow turns live, choose which agents answer, message the crew, act on the workspace results and approvals it returns, attach documents and photos, see maps, share a location beacon, read recent rooms offline, and receive approval and important-email push notifications.",
            owner: "Crew Platform",
        },
        technical_spec: {
            inputs: {
                server_url: "string",
                session_key: "string",
                message: "string",
                form_submission: "object | null",
                fcm_token: "string | null",
                active_agent_card_ids: "integer[] | null",
                selected_context: "object[] | null",
                beacon: "object | null",
                attachments: "file[] | null",
            },
            outputs: {
                turns: "object[]",
                room_state: "object",
                device_registered: "boolean",
                beacon_notified: "integer | null",
            },
        },
        documentation_meta: {
            summary: "A native client of the CREW room API: the same /api/crew routes and session cookie as the web room, with chat forms evaluated by a Kotlin port of the web form engine.",
            business_use_cases: [
                "Let squad members in the field follow and steer a CREW room from their phone.",
                "Fill an agent-rendered form on a phone and have the crew react exactly as to a browser submission.",
                "Reach a person with a pending approval or an important email while the app is closed.",
                "Review and send a drafted email, or approve a calendar or Google Workspace change, from the phone.",
                "Share where you are with everyone in the project, from the room, so people and agents can plan around it.",
                "Photograph a site, a document or a whiteboard and give it to the crew from the phone.",
            ],
            guardrails: [
                // Turns are attributed from req.session.userId; an org API key would
                // post every phone turn as "Guest".
                "The app authenticates with the person's own session, never an org API key, so every turn is attributed to the human who sent it.",
                "The server's idle expiry is respected: the app asks the person to sign in again and never stores a password.",
                "Form submissions must match the web's message text and computed values; parity fixtures are generated from the TypeScript engine.",
                "A push token is removed when its person signs out and dropped when FCM reports it unregistered.",
                "Cleartext HTTP is allowed only in debug builds; a release build requires an https origin.",
                "Saved rooms stay in the app's private cache, keyed to server and account, and are deleted on sign-out.",
                "A location beacon is one confirmed fix posted to the room; the phone never tracks or sends location on its own.",
                "Links and images from tool results open only on the hosts the web card allowlists.",
            ],
        },
        runtime_context: {
            risk_profile: "Medium",
            execution_environment: "Host",
            dependencies: ["crew", "auth", "notifications", "forms", "integrations"],
        },
    },
];

export const ODDJOB_EXECUTABLE_CAPABILITY_MANIFESTS: CapabilityManifest[] = definitions.map((definition) =>
    parseCapabilityManifest(definition),
);

