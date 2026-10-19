# App Forge: Industrial Assembly Lifecycle

The **App Forge** is Oddjob's high-fidelity autonomous delivery engine. It transforms raw requirements, design mockups, and technical specifications into hardened, containerized React applications using a 7-stage "Industrial Assembly" pipeline.

---

## 1. Phase I: Discovery (Intelligence Ingestion)
The pipeline begins by gathering all available context to inform the AI Architect.

- **RAG Ingestion**: Ingests uploaded documents (PDFs, Docs, API Specs) into a temporary vector context.
- **Vision Analysis**: Performs multi-modal analysis of UI mockups or whiteboard drawings.
- **Design Identity**: Fetches curated design tokens (colors, fonts, radii) from the industrial style catalog.
- **Org Context**: Automatically inherits coding standards and security policies from the Forge Settings.

## 2. Phase II: Strategy (Requirement Decomposition)
The **AI Architect** analyzes the discovery data and proposes a functional strategy.

- **Feature Mapping**: Decomposes the high-level request into specific technical features.
- **Goal Alignment**: Ensures the app meets the specific objectives of the linked Oddjob Mission.
- **Governance Check**: Validates the proposed features against organizational security policies.
- **[GATE] Approval**: The process suspends here. The user must review and approve the strategy before code is written.

## 3. Phase III: Architecture (Technical Blueprinting)
Once the strategy is approved, the Architect designs the application's internal structure.

- **Schema Design**: Defines the data models and Zod validation schemas.
- **API Proxying**: Identifies external APIs and designs server-side proxy routes to handle auth and CORS.
- **Routing Manifest**: Maps out the React page structure and navigation flow.
- **[GATE] Technical Review**: The process suspends again. The user reviews the technical architecture, including proposed API integrations and data flows.

## 4. Phase IV: Assembly (Generative Codegen)
The "Core Forge" initiates a multi-turn collaboration between specialized AI agents.

- **AI Architect**: Generates the structural framework, hooks, and core business logic.
- **AI Designer**: Injects the selected visual identity (industrial style tokens) and builds premium UI components.
- **Titan Critique**: A high-fidelity "Titan" model audits the generated code for defects, responsiveness, and aesthetic quality.
- **Refinement Loop**: If the quality score is below 80/100, the Designer performs targeted refinements based on the Critique's feedback.

## 5. Phase V: Hardening (Quality Assurance)
The raw code is subjected to automated verification and repair cycles.

- **TypeScript Validation**: Runs `tsc --noEmit` to find type errors.
- **Automated Patching**: Detected errors are sent back to the AI for targeted fixes in real-time.
- **Dependency Sanitization**: Removes "AI-hallucinated" or insecure packages from `package.json`.
- **Import Resolution**: Fixes pathing issues and ensures all domain components are correctly linked.

## 6. Phase VI: Industrialization (Containerization)
The application is transformed into a deployable industrial unit.

- **Dependency Synchronization**: Restores `node_modules` from a blueprint-keyed cache to reduce build time from minutes to seconds.
- **Next.js Build**: Executes a production build on the host to ensure all assets are optimized.
- **Docker Assembly**: Packs the application into a hardened OCI container image.
- **Stitch Sync**: Finalizes the Stitch design system and pushes the latest design tokens to the project.

## 7. Phase VII: Ignition (Deployment & Health)
The forged application is launched into the live environment.

- **Pool Claim**: Claim a pre-warmed industrial container unit from the pool.
- **Ignition Sequence**: Starts the container and maps networking routes.
- **Telemetry Link**: Establishes a real-time SSE link for build logs and status updates.
- **Health Verification**: Polls the internal deployment until the application is fully responsive.
- **Auto-Handoff Beacon**: Upon container health confirmation, initiates an animated Ignition Success Banner with a 3-second auto-redirect countdown into **App Builder Studio** (`/armory/apps/:id?tab=preview`).

---

## 8. Phase VIII: Customization (App Builder Studio End-State)
Rather than dead-ending at a deployment summary, forged applications immediately land in the **App Builder Studio**, Oddjob's live interactive workshop.

- **Seamless Auto-Transition**: Automatically transfers context from Forge into Studio, eliminating manual navigation friction while preserving a pause toggle (`Stay on Logs`) for deep trace analysis.
- **4-Zone Targeted Grid Drag-and-Drop**: Developers drag representative primitives from the Primitives Catalog and drop them into designated spatial quadrants:
  - **Top Slot**: Full-width header/hero banner placement above the main content.
  - **Left Slot**: Targeted Column 1 placement beneath primary metric cards.
  - **Right Slot**: Targeted Column 2 placement beneath secondary network panels.
  - **Bottom Slot**: Full-width footer placement spanning the application base.
- **Normalized AI Edit Pipeline**: A recursive normalization layer unwraps arbitrary LLM response structures (arrays, nested file envelopes, `{ code }`/`{ content }` keys) into clean, flat string file maps, preventing synthesis drop failures.
- **Interactive Element Selector**: Click any rendered DOM element in the live preview to automatically scope targeted AI prompts (`Select Mode`).
- **Adaptive Canvas for Headless APIs**: When an app is built without visual UI components (APIs, daemons, event consumers), the Studio center canvas renders an **OpenAPI 3.1 Swagger & Request Playground**, complete with live method badges (`GET`, `POST`, `PUT`, `DELETE`), cURL generator, and sub-millisecond execution runner.

---

## 9. Phase IX: Launchpad (Top-Bar Direct Publishing)
Production deployment is an immediate, in-context action executed directly from the Builder Studio top toolbar.

- **Persistent Status Beacon**: Real-time indication of deployment state (`● PUBLISHED` vs `○ DRAFT`) positioned alongside the live container port beacon.
- **Focused Go-Live Modal**: Clicking `[🚀 Publish App]` opens a lightweight publishing modal without interrupting the live preview or resetting builder state.
- **Access Governance**: Configure endpoint accessibility with enterprise policies:
  - `Organization Only`: Restricted to authenticated enterprise users.
  - `Public`: Globally accessible at edge routes (`/forged/:slug`).
  - `Password Guarded`: Protected by a shared operational passcode.
- **Release Versioning**: Assign semantic tags (`v1.0.0`) and changelog notes that are recorded in the immutable platform ledger.
- **Production Asset Distribution**: Instant generation of canonical production URLs and responsive intranet iframe embed code snippets (`<iframe src="..." />`).

---

## Resilience & Governance Features

### 1. Quota Governance (429 Mitigation)
To handle high-volume AI requests and Google Gemini 429 (Resource Exhausted) errors, the App Forge uses an **Adaptive Quota Management** system:

- **Priority Throttling**: 
  - **Interactive Tasks** (Discovery, Planning, Initial Build) are marked as `isPriority: true`. They bypass global cool-downs and have shorter reserved slots.
  - **Background Tasks** (Shadow Audits, Regression Checks) are marked as `isPriority: false`. They will yield and wait if a global 429 block is active.
- **Global Cool-down**: When a 429 error is detected, the system sets a 2-minute "block" in Redis for all background tasks, allowing the API quota to recover for interactive use.
- **Jittered Backoff**: Retries use exponential backoff with random jitter to prevent "thundering herd" spikes during recovery.
- **Diagnosis Suppression**: Rate-limit errors (429) do not trigger AI-driven diagnosis to avoid recursive quota exhaustion.

### 2. Infrastructure Stability
- **Redis Persistence**: Job state is saved in Redis, allowing builders to survive server restarts or network interruptions.
- **Blueprint System**: Every app starts from one of 8 battle-tested blueprints (`analytics-dashboard`, `chat-assistant`, `crud-app`, `api`, `spa`, `pwa`, `rescue-dispatch`, `mission-supervisor`). Each blueprint includes a pre-wired `pages/api/oddjob/[...path].ts` platform proxy so generated routes can call Oddjob platform services without additional setup.
- **Policy Enforcement**: Settings for strict TypeScript, OWASP compliance, and mandatory unit testing are injected directly into the AI's system prompts.

---

## 10. Phase X: Agentic Collaboration in CREW (3-Column Balanced Cockpit)
App Forge is fully unified into Oddjob's **CREW Agentic Agency**, moving away from legacy standalone forms into an integrated, side-by-side 3-column workspace cockpit:

- **Unified Launchpad**: Armory's Forge Studio tile links directly to `/workspace/chat?studio=forge`, smoothly crossing the SPA boundary with automated query parameter preservation and room auto-mounting.
- **Left Column (Agent Chat & Squad Deliberation)**: The active squad (Copilot, Architect, Developer) actively collaborates with the user, answering architectural questions, generating specifications, and proposing code diffs.
- **Center Canvas (App Studio Pod)**:
  - **6 Architecture Archetypes**: Select from curated foundations (`Analytics Dashboard`, `AI Workforce Dashboard`, `Chat Assistant`, `Data Workbench / CRUD`, `Operations Console`, `Workflow Wizard`) with starter packs and prompt suggestions.
  - **3-Phase Walkthrough**: Guided progression from Archetype Selection → Specifications & Requirements (Slug, User Stories, API endpoints, Scaffold packs) → Pre-Flight Review & Ignition.
  - **Live Assembly & SSE Streaming**: Real-time SSE event stream displaying step logs, terminal statuses, and live assembly preview with automatic in-place promotion to Builder.
- **Right Column (Cycle Pipeline & Modular Assembly Rail)**:
  - **Cycle DAG Progress**: Vertical tracker for `1. Ingest`, `2. Triage & Deliberation`, `3. Squad Dispatch`, and `4. Telemetry Handshake`.
  - **Modular Assembly Stack**: 4-layer checklist displaying readiness for `UI / View Component`, `Pipeline / Logic DAG`, `Dataset Schema`, and `Project Scope`.
  - **Collapsible Mini-Spine**: Quick-collapse toggle (`w-12`) to maximize canvas width when focusing on deep code edits or visual assembly.

