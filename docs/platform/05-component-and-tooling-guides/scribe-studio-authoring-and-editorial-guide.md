# Scribe Studio: Authoring, Editorial & Persona Collaboration Guide

Scribe Studio is Oddjob's governed, nonlinear authoring pod designed for longform manuscripts, enterprise legal agreements, product specifications (PR/FAQs), investment decks, and technical papers.

Unlike conventional word processors that treat documents as flat text buffers, Scribe Studio models authoring as a **station-based subway graph** with automated causality analysis, multi-lens persona auditing, interactive margin notes/to-dos, and real-time biometric pacing telemetry.

---

## 1. Core Architecture & 4-Pane Workspace

Scribe Studio operates as a synchronized 4-pane creative environment inside CREW rooms:

```
┌─────────────────────────────── Scribe Studio Header ────────────────────────────────┐
│ [Book] Title: Enterprise SaaS MSA  • Archetype: SAAS MSA  •  [Focus Studio] [Exit]   │
├───────────────────┬───────────────────────────────────┬─────────────────────────────┤
│ 1. SUBWAY SPINE   │ 2. LIVING DOCUMENT CANVAS         │ 3. MULTI-LENS CRITIC HUB    │
│                   │                                   │                             │
│ ◉ Station 1: Intro│  # Section 1: Services Overview   │ 👥 Critic Hub    [+ Add] [▶]│
│ │   [Synced • 420w│                                   │ ┌─────────────────────────┐ │
│ ◉ Station 2: Term │  Customer agrees to subscribe...  │ │ ⚖️ LEGAL SENTINEL       │ │
│ ├──◯ Branch B: Fee│                                   │ │ Uncapped Liability Risk │ │
│ ◉ Station 3: Liab │  [🖍️ Highlight] [📝 Note] [⚡ AI]   │ │ [Apply Proposed Fix]    │ │
│ ⚠️ Conflict Alert │                                   │ └─────────────────────────┘ │
├───────────────────┴───────────────────────────────────┴─────────────────────────────┤
│ 4. TELEMETRY & EXPORT DOCK                                                          │
│ Total: 4,820 words • Target: 10,000w • EKG Waveform [~~~/\~~~] • Export: [MD|PDF|DOCX]│
└─────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Vertical Subway Spine (Left Rail)**: Visualizes the narrative or legal progression as subway stations. Tracks parallel branches, station completion states, word targets, and downstream continuity conflicts.
2. **Paginated Living Canvas (Center Stage)**: High-contrast, typography-optimized manuscript sheet supporting inline editing, floating AI rewrites, color highlighters, and context-pinned note creation.
3. **Multi-Lens Critic Hub (Right Rail)**: Multi-agent editorial gallery that critiques the active station across specialized lenses (Legal, Style, Pacing, Devil's Advocate, Fact Check) with one-click diff applications.
4. **Telemetry & Export Dock (Bottom Bar)**: Real-time readability index, word pacing targets, EKG tension curve visualization, and multi-format exporters (Markdown, PDF, Word DOCX).

---

## 2. Archetype Structural Frameworks

When initializing a manuscript with `mount_scribe_studio`, Scribe Studio configures stations according to proven structural archetypes:

| Archetype (`archetypeMode`) | Ideal Use Case | Default Stations / Milestone Nodes |
| :--- | :--- | :--- |
| **`saas_msa`** | B2B Software Agreements | Recitals → Services & SLA → Fees & Billing → Confidentiality → IP Ownership → Indemnification → Limitation of Liability → Term & Termination → Dispute Resolution |
| **`heros_journey`** | Novels, Fiction, Screenplays | Ordinary World → Call to Adventure → Refusal → Meeting Mentor → Crossing Threshold → Tests & Allies → Inmost Cave → Supreme Ordeal → Reward → Road Back → Resurrection → Return with Elixir |
| **`story_circle`** | Fast Paced Fiction & Episodic | You (Comfort) → Need → Go (Unfamiliar) → Search → Find → Take (Heavy Price) → Return → Changed |
| **`save_the_cat`** | Screenwriting & Narrative Arcs | Opening Image → Theme Stated → Set-up → Catalyst → Debate → Break into Two → B Story → Fun and Games → Midpoint → Bad Guys Close In → All Hope is Lost → Dark Night → Break into Three → Finale → Final Image |
| **`amazon_prfaq`** | Product Proposals & Strategy | Heading & Summary → Problem Definition → Solution Description → Leader Quote → Customer Testimonial → Call to Action → Internal & Customer FAQs |
| **`minto_pyramid`** | Executive Memos & Consultative | Executive Summary (SCQA) → Core Recommendation → Pillar 1 Evidence → Pillar 2 Evidence → Pillar 3 Evidence → Implementation Roadmap → Risk Mitigation |
| **`yc_pitch_deck`** | Investor Pitch & Decks | Problem Statement → Solution & Secret Sauce → Market Size (TAM/SAM) → Traction & Metrics → Business Model → Go-To-Market → Competitive Advantage → Team & Ask |
| **`imrad_paper`** | Scientific & Research Papers | Abstract → Introduction & Background → Methods & Materials → Results & Data → Discussion & Limitations → References |
| **`freeform`** | Custom Documents & Notes | Overview & Objectives → Core Body → Conclusion & Next Steps |

---

## 3. Authoring Best Practices for Humans & AI Personas

### A. Highlighting & Margin Notes
* **Highlighting**: Select any sentence in the Living Canvas to trigger the floating quick-action pill:
  - 🟨 **Yellow (`bg-amber-300/40`)**: Standard editorial highlight or anchor.
  - 🟩 **Green (`bg-emerald-400/30`)**: Approved phrasing, key definitions, or positive references.
  - 🟦 **Blue (`bg-sky-400/30`)**: External dependencies, data bindings, or legal citations.
* **Creating Action Items**: Click **`To-Do`** on the selection pill or **`+ Add`** in the Critic Hub. To-Dos feature toggleable checkboxes that strike through text upon completion and persist across sessions.

### B. Focus Targeting with CREW Agent Personas
To collaborate with CREW personas on a specific section:
1. In the **Living Canvas**, select the text and click **`💬 Discuss in Chat`** (or click **`💬 Discuss with Crew`** on any Critic Card).
2. Scribe Studio automatically opens the chat panel and mounts a **Focused Scope Chip** in the composer (e.g. `[🎯 Station: Indemnity Clause • Excerpt: "Customer shall indemnify..."]`).
3. Mention the relevant specialist:
   - `@GhostWriter`: Narrative sensory detail, dialogue velocity, metaphor elevation.
   - `@LegalSentinel`: Liability limitation, safe harbor language, mutual remedies.
   - `@CopyEditor`: Grammar polish, passive voice reduction, brevity.
   - `@DataAnalyst`: Fact checking against Knowledge Garden datasets and Snowflake metrics.

### C. The 1-Click Diff Workflow
When an agent or critic audit generates a proposed improvement:
1. View the **`⚡ Proposed Adjustment`** block inside the Critic Hub card.
2. Click **`[⚡ Apply Proposed Fix]`**.
3. Scribe Studio applies the replacement directly into the active Living Canvas and triggers auto-save without requiring manual copy-pasting.

---

## 4. Branch Management & Continuity Engine

### A. Forking Subway Branches
When evaluating alternative creative plotlines or negotiating contractual concessions:
1. Click **`[+ Fork Track Branch]`** in the Subway Spine header.
2. Give the branch a descriptive title (e.g. *"Branch B: 12-Month Fee Cap Compromise"* or *"Branch C: Stealth Infiltration Alternate"*).
3. Scribe Studio clones all station checkpoints into a sandboxed parallel track. Edits made on Branch B will not affect the main trunk.

### B. Forward-Propagation Continuity Checks
When modifying an upstream station (e.g. killing a character in Chapter 2, or changing a fee schedule in Clause 3):
1. The Scribe Continuity Engine analyzes all downstream stations for causality violations.
2. If a downstream station references an outdated premise, the station is marked with a red **`⚠️ Continuity Conflict`** badge.
3. Hovering over the badge displays the conflict rationale and suggested resolution.

---

## 5. Pre-Publication Editorial Checklist

Before exporting a completed manuscript or contract, follow this standard audit checklist:

- [ ] **1. Station Completion**: Verify all stations on the active subway track show `approved` or `in_review` (no empty placeholders).
- [ ] **2. Multi-Lens Audit Pass**: Click **`Audit Pass`** in the Critic Hub to execute Legal, Style, Pacing, and Devil's Advocate evaluations.
- [ ] **3. Resolve Open To-Dos**: Filter the Critic Hub by **`Notes & To-Dos`** and ensure all checklist items are checked off `[✓]`.
- [ ] **4. Continuity Reconciliation**: Run `@EditorialSupervisor reconcile continuity` to ensure zero downstream logical contradictions.
- [ ] **5. Target Pacing & Word Count**: Verify total word count against the target in the bottom Telemetry Dock.
- [ ] **6. Multi-Format Export**: Compile and download via **`[Export PDF]`**, **`[Export Word DOCX]`**, or **`[Export Markdown]`**.
- [ ] **7. Publish to Project Deliverables**: Click **`[🚀 Publish to Project]`** to commit the release version into canonical project files and room attachments.

---

## 6. Publishing & Project Asset Persistence Lifecycle

Scribe Studio seamlessly graduates completed manuscripts from ephemeral room working drafts into immutable project-level deliverables:

1. **1-Click Publishing (`[🚀 Publish to Project]`)**:
   - Located in the bottom **Telemetry & Export Dock**.
   - Opens the **Release Version Modal** to configure semantic version tag (e.g. `v1.0.0-final`), release notes, and target project destination.
2. **Immutable Deliverable Registration**:
   - The compiled manuscript is committed into `file_blobs` and linked to `crew_attachments`.
   - Document metadata is immutably updated in `scribe_documents.settings.publications`.
3. **Supervisor Room Announcement**:
   - Emits an announcement turn into the CREW room with direct download links and asset badges.
4. **CREW Closing Brief Section 3 Integration**:
   - When the CREW session concludes, all published Scribe Studio manuscripts are automatically embedded in **Section 3: Scribe Studio Deliverables & Longform Manuscripts** of the Closing Brief.

