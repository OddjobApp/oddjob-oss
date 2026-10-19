/**
 * Scribe Studio Framework Archetypes
 *
 * Defines the structural stations, target word count distributions,
 * and default persona critic squads for 10 document types.
 */

import { ScribeArchetypeMode, ScribeLensType } from "@shared/schema/scribe.js";

export interface ScribeStationTemplate {
    stationKey: string;
    title: string;
    description: string;
    targetPercentage: number; // e.g. 0.12 (12%)
    suggestedScaffolding?: string;
    requiredClausesOrBeats?: string[];
}

export interface ScribeFrameworkDefinition {
    mode: ScribeArchetypeMode;
    name: string;
    category: "creative" | "legal" | "business" | "academic" | "general";
    description: string;
    defaultTargetWordCount: number;
    recommendedAgentRoles: string[];
    defaultLenses: ScribeLensType[];
    stations: ScribeStationTemplate[];
}

export const SCRIBE_FRAMEWORKS: Record<ScribeArchetypeMode, ScribeFrameworkDefinition> = {
    heros_journey: {
        mode: "heros_journey",
        name: "The Hero's Journey (12 Beats)",
        category: "creative",
        description: "Campbellian Monomyth structure for epic novels, memoirs, sci-fi/fantasy, and character-driven screenplays.",
        defaultTargetWordCount: 40000,
        recommendedAgentRoles: ["Story Architect", "Dialogue Coach", "Pacing SME"],
        defaultLenses: ["stylistic", "pacing", "devils_advocate"],
        stations: [
            { stationKey: "ordinary_world", title: "1. The Ordinary World", description: "Establish the status quo, flaw, and internal longing.", targetPercentage: 0.08 },
            { stationKey: "call_to_adventure", title: "2. Call to Adventure", description: "Inciting disruption that challenges the ordinary world.", targetPercentage: 0.05 },
            { stationKey: "refusal_of_call", title: "3. Refusal of the Call", description: "Hesitation, fear, or obligations raising the stakes.", targetPercentage: 0.05 },
            { stationKey: "meeting_mentor", title: "4. Meeting the Mentor", description: "Wisdom, talisman, or training to prepare for departure.", targetPercentage: 0.07 },
            { stationKey: "crossing_threshold", title: "5. Crossing the First Threshold", description: "Entering the unfamiliar world; point of no return.", targetPercentage: 0.08 },
            { stationKey: "tests_allies_enemies", title: "6. Tests, Allies & Enemies", description: "Navigating the rules of the special world; building crew.", targetPercentage: 0.15 },
            { stationKey: "approach_cave", title: "7. Approach to the Inmost Cave", description: "Heightening tension and preparing for the central crisis.", targetPercentage: 0.10 },
            { stationKey: "the_ordeal", title: "8. The Ordeal (Midpoint Crisis)", description: "Direct confrontation with greatest fear/death; symbolic death & rebirth.", targetPercentage: 0.12 },
            { stationKey: "the_reward", title: "9. The Reward (Seizing the Sword)", description: "Claiming the insight, elixir, or revelation from surviving the ordeal.", targetPercentage: 0.08 },
            { stationKey: "the_road_back", title: "10. The Road Back", description: "Urgency, pursuit, and recommitment to complete the journey.", targetPercentage: 0.08 },
            { stationKey: "the_resurrection", title: "11. The Resurrection (Climax)", description: "Final exam testing the hero's ultimate internal transformation.", targetPercentage: 0.09 },
            { stationKey: "return_with_elixir", title: "12. Return with the Elixir", description: "Returning home transformed, carrying value for the community.", targetPercentage: 0.05 },
        ],
    },

    story_circle: {
        mode: "story_circle",
        name: "Dan Harmon Story Circle (8 Beats)",
        category: "creative",
        description: "Symmetric 8-beat character engine for episodic fiction, scripts, and compact narrative arcs.",
        defaultTargetWordCount: 15000,
        recommendedAgentRoles: ["Story Architect", "Dialogue Coach"],
        defaultLenses: ["stylistic", "pacing"],
        stations: [
            { stationKey: "you_comfort", title: "1. You (Comfort Zone)", description: "Establish character in familiar setting.", targetPercentage: 0.12 },
            { stationKey: "need_desire", title: "2. Need (Desire)", description: "They want something that breaks their comfort.", targetPercentage: 0.12 },
            { stationKey: "go_unfamiliar", title: "3. Go (Cross Threshold)", description: "They enter an unfamiliar situation.", targetPercentage: 0.13 },
            { stationKey: "search_adapt", title: "4. Search (Adapt)", description: "They adapt to the road of trials.", targetPercentage: 0.13 },
            { stationKey: "find_obtain", title: "5. Find (Get what they wanted)", description: "They achieve their initial desire.", targetPercentage: 0.13 },
            { stationKey: "take_price", title: "6. Take (Pay heavy price)", description: "The heavy consequence of getting what they wanted.", targetPercentage: 0.13 },
            { stationKey: "return_familiar", title: "7. Return (Come back)", description: "They return to their original world.", targetPercentage: 0.12 },
            { stationKey: "change_transform", title: "8. Change (Transformed)", description: "Having fundamentally transformed.", targetPercentage: 0.12 },
        ],
    },

    save_the_cat: {
        mode: "save_the_cat",
        name: "Save the Cat! (15 Beats)",
        category: "creative",
        description: "Blake Snyder commercial structure for thrillers, mysteries, and page-turning commercial fiction.",
        defaultTargetWordCount: 30000,
        recommendedAgentRoles: ["Commercial Story Editor", "Pacing SME"],
        defaultLenses: ["stylistic", "pacing", "devils_advocate"],
        stations: [
            { stationKey: "opening_image", title: "1. Opening Image", description: "Snapshot of protagonist's flawed world.", targetPercentage: 0.03 },
            { stationKey: "theme_stated", title: "2. Theme Stated", description: "Premise hint spoken to protagonist.", targetPercentage: 0.02 },
            { stationKey: "set_up", title: "3. Set-Up", description: "Explore the status quo and stakes.", targetPercentage: 0.08 },
            { stationKey: "catalyst", title: "4. Catalyst", description: "Life-altering inciting event.", targetPercentage: 0.03 },
            { stationKey: "debate", title: "5. Debate", description: "Should I stay or should I go?", targetPercentage: 0.05 },
            { stationKey: "break_into_two", title: "6. Break into Act Two", description: "Choice to enter the new world.", targetPercentage: 0.04 },
            { stationKey: "b_story", title: "7. B-Story", description: "Love interest or mentor dynamic.", targetPercentage: 0.05 },
            { stationKey: "fun_and_games", title: "8. Fun & Games", description: "The promise of the premise in action.", targetPercentage: 0.20 },
            { stationKey: "midpoint", title: "9. Midpoint", description: "False victory or false defeat raising the stakes.", targetPercentage: 0.05 },
            { stationKey: "bad_guys_close_in", title: "10. Bad Guys Close In", description: "Internal and external pressure mounts.", targetPercentage: 0.15 },
            { stationKey: "all_is_lost", title: "11. All Is Lost", description: "Whiff of death; lowest point.", targetPercentage: 0.05 },
            { stationKey: "dark_night_of_soul", title: "12. Dark Night of the Soul", description: "Processing the loss before the final epiphany.", targetPercentage: 0.05 },
            { stationKey: "break_into_three", title: "13. Break into Act Three", description: "The new insight unlocks the solution.", targetPercentage: 0.03 },
            { stationKey: "finale", title: "14. Finale", description: "Executing the plan and facing the antagonist.", targetPercentage: 0.14 },
            { stationKey: "final_image", title: "15. Final Image", description: "Proof that change has occurred.", targetPercentage: 0.03 },
        ],
    },

    saas_msa: {
        mode: "saas_msa",
        name: "Enterprise B2B SaaS MSA & DPA",
        category: "legal",
        description: "Master Services Agreement, Service Levels, Data Protection Addendum (GDPR/CCPA), and Security standards.",
        defaultTargetWordCount: 6000,
        recommendedAgentRoles: ["Corporate Legal Counsel", "Privacy & Risk Officer", "Deal Negotiator"],
        defaultLenses: ["legal", "devils_advocate", "stylistic"],
        stations: [
            { stationKey: "preamble_recitals", title: "1. Preamble & Commercial Recitals", description: "Parties, effective date, background recitals.", targetPercentage: 0.05 },
            { stationKey: "services_licensing", title: "2. Provision of Services & Licensing", description: "Authorized seats, permitted use, subscription rights, restrictions.", targetPercentage: 0.12 },
            { stationKey: "sla_support", title: "3. Service Levels & Support Commitments", description: "99.9% uptime, severity tier responses, maintenance windows, credit remedies.", targetPercentage: 0.12 },
            { stationKey: "data_protection_dpa", title: "4. Data Protection & GDPR/CCPA Addendum", description: "Customer ownership, security protocols, subprocessors, SCCs, breach notice.", targetPercentage: 0.18 },
            { stationKey: "fees_payment", title: "5. Fees, Invoicing & Payment Terms", description: "Net 30, fee schedule, late interest, tax responsibilities, dispute process.", targetPercentage: 0.08 },
            { stationKey: "representations_warranties", title: "6. Representations, Warranties & Disclaimers", description: "Authority, performance warranty, malware disclaimer, AS-IS carveouts.", targetPercentage: 0.08 },
            { stationKey: "indemnification", title: "7. Third-Party IP Indemnification", description: "Mutual indemnity, IP infringement defense, exclusions, procedure.", targetPercentage: 0.12 },
            { stationKey: "limitation_of_liability", title: "8. Limitation of Liability & Consequential Waiver", description: "12-month trailing fee cap, exclusions (gross negligence, IP, privacy breach).", targetPercentage: 0.10 },
            { stationKey: "term_termination", title: "9. Term, Suspension & Termination", description: "Auto-renewal, termination for cause (30 days), transition assistance, data return.", targetPercentage: 0.08 },
            { stationKey: "governing_law_misc", title: "10. Governing Law, Venue & General Provisions", description: "Jurisdiction, dispute escalation, entire agreement, severability, notices.", targetPercentage: 0.07 },
        ],
    },

    harvard_batna: {
        mode: "harvard_batna",
        name: "Harvard Principled Negotiation (BATNA)",
        category: "legal",
        description: "Interest-based deal architecture with tiered fallback concessions and counterparty leverage modeling.",
        defaultTargetWordCount: 4000,
        recommendedAgentRoles: ["Deal Negotiator", "Legal Counsel"],
        defaultLenses: ["legal", "devils_advocate"],
        stations: [
            { stationKey: "shared_interests", title: "1. Shared Objectives & Strategic Alignment", description: "Mutual value creation and joint business vision.", targetPercentage: 0.15 },
            { stationKey: "core_deal_terms", title: "2. Core Value Exchange & Deliverables", description: "Scope, milestones, and commercial commitments.", targetPercentage: 0.25 },
            { stationKey: "risk_allocation", title: "3. Balanced Risk Distribution", description: "Warranties, compliance, and liability apportionment.", targetPercentage: 0.20 },
            { stationKey: "fallback_matrix", title: "4. Tiered Concession Matrix (BATNA)", description: "Pre-approved compromise positions for negotiation leverage.", targetPercentage: 0.20 },
            { stationKey: "governance_escalation", title: "5. Relationship Governance & Escalation", description: "Executive review cadence and dispute avoidance.", targetPercentage: 0.20 },
        ],
    },

    amazon_prfaq: {
        mode: "amazon_prfaq",
        name: "Amazon PR/FAQ (Working Backwards)",
        category: "business",
        description: "Amazon's gold-standard product requirement document starting from the future press release.",
        defaultTargetWordCount: 3500,
        recommendedAgentRoles: ["Principal Architect", "Product Strategist", "Amazon Bar Raiser"],
        defaultLenses: ["stylistic", "devils_advocate", "fact_check"],
        stations: [
            { stationKey: "press_release", title: "1. Press Release (Future Launch Headline)", description: "Customer headline, date, city, customer quote, executive quote.", targetPercentage: 0.20 },
            { stationKey: "customer_problem", title: "2. Customer Problem Statement", description: "Deep dive on customer pain and why current alternatives fail.", targetPercentage: 0.15 },
            { stationKey: "customer_solution", title: "3. The Proposed Experience", description: "How the product works from the customer's perspective.", targetPercentage: 0.20 },
            { stationKey: "customer_faq", title: "4. Customer FAQ", description: "Top questions a customer will ask about pricing, availability, migration.", targetPercentage: 0.20 },
            { stationKey: "internal_exec_faq", title: "5. Internal Stakeholder & Tech FAQ", description: "Architecture, margins, edge cases, risks, and resource requirements.", targetPercentage: 0.25 },
        ],
    },

    minto_pyramid: {
        mode: "minto_pyramid",
        name: "McKinsey Minto Pyramid (SCQA)",
        category: "business",
        description: "Executive top-down communication framework ensuring MECE clarity and actionable recommendations.",
        defaultTargetWordCount: 2500,
        recommendedAgentRoles: ["McKinsey Engagement Mgr", "Executive Reviewer"],
        defaultLenses: ["stylistic", "devils_advocate", "fact_check"],
        stations: [
            { stationKey: "scqa_hook", title: "1. SCQA Executive Hook", description: "Situation, Complication, Question, and Core Answer upfront.", targetPercentage: 0.20 },
            { stationKey: "pillar_1", title: "2. Strategic Pillar 1 (Core Rationale)", description: "First Mutually Exclusive, Collectively Exhaustive pillar.", targetPercentage: 0.25 },
            { stationKey: "pillar_2", title: "3. Strategic Pillar 2 (Economic / Operational Proof)", description: "Second MECE supporting pillar with quantified data.", targetPercentage: 0.25 },
            { stationKey: "pillar_3", title: "4. Strategic Pillar 3 (Implementation / Defensibility)", description: "Third MECE pillar detailing execution roadmap.", targetPercentage: 0.20 },
            { stationKey: "action_call", title: "5. Decision Request & Next Steps", description: "Concrete board/executive approvals requested.", targetPercentage: 0.10 },
        ],
    },

    yc_pitch_deck: {
        mode: "yc_pitch_deck",
        name: "Sequoia / YC Pitch Deck Blueprint",
        category: "business",
        description: "High-conviction venture capital pitch arc from hair-on-fire problem to massive financial returns.",
        defaultTargetWordCount: 2000,
        recommendedAgentRoles: ["Tier-1 Venture Partner", "Financial Strategist"],
        defaultLenses: ["devils_advocate", "stylistic", "fact_check"],
        stations: [
            { stationKey: "problem_hair_on_fire", title: "1. The Hair-on-Fire Problem", description: "Urgent, growing, unaddressed customer pain.", targetPercentage: 0.10 },
            { stationKey: "the_secret_insight", title: "2. The Secret Insight", description: "Why now? The paradigm shift enabling this solution.", targetPercentage: 0.10 },
            { stationKey: "the_product", title: "3. The Product & Magic", description: "How it works in 3 clear steps.", targetPercentage: 0.15 },
            { stationKey: "market_velocity_tam", title: "4. Market Velocity & TAM", description: "Bottom-up addressable market calculation.", targetPercentage: 0.10 },
            { stationKey: "traction_unit_economics", title: "5. Traction & Unit Economics", description: "Growth rates, retention, LTV/CAC, margins.", targetPercentage: 0.15 },
            { stationKey: "the_moat_defensibility", title: "6. Defensibility & Unfair Moats", description: "Network effects, data flywheel, switching costs.", targetPercentage: 0.15 },
            { stationKey: "the_team", title: "7. Founding Team", description: "Why this team is uniquely qualified to win.", targetPercentage: 0.10 },
            { stationKey: "the_ask", title: "8. The Financial Ask & Milestones", description: "Capital raise target and 18-month execution goals.", targetPercentage: 0.15 },
        ],
    },

    imrad_paper: {
        mode: "imrad_paper",
        name: "IMRaD Scientific Paper Standard",
        category: "academic",
        description: "Standard peer-reviewed research manuscript structure: Introduction, Methods, Results, Discussion.",
        defaultTargetWordCount: 8000,
        recommendedAgentRoles: ["Peer Reviewer #2", "Statistical Auditor"],
        defaultLenses: ["fact_check", "stylistic", "devils_advocate"],
        stations: [
            { stationKey: "abstract_intro", title: "1. Abstract & Introduction", description: "Hypothesis, literature gap, and core contribution.", targetPercentage: 0.20 },
            { stationKey: "methodology", title: "2. Methodology & Materials", description: "Reproducible experimental protocol and statistical setup.", targetPercentage: 0.25 },
            { stationKey: "results_findings", title: "3. Results & Empirical Findings", description: "Data visualizations, metrics, statistical significance.", targetPercentage: 0.30 },
            { stationKey: "discussion_limitations", title: "4. Discussion, Limitations & Future Work", description: "Interpretation, theoretical implications, and edge cases.", targetPercentage: 0.25 },
        ],
    },

    freeform: {
        mode: "freeform",
        name: "Dynamic Freeform Outline",
        category: "general",
        description: "Adaptive blank canvas that creates custom outline stations based on user prompts.",
        defaultTargetWordCount: 5000,
        recommendedAgentRoles: ["Story Architect", "Stylistic Editor"],
        defaultLenses: ["stylistic", "devils_advocate"],
        stations: [
            { stationKey: "overview", title: "1. Overview & Objectives", description: "Background and goals.", targetPercentage: 0.25 },
            { stationKey: "core_body", title: "2. Main Body", description: "Core content and development.", targetPercentage: 0.50 },
            { stationKey: "conclusion", title: "3. Summary & Conclusion", description: "Key takeaways and next actions.", targetPercentage: 0.25 },
        ],
    },

    // ── Business Document Archetypes ──────────────────────────────────────────

    sow_statement_of_work: {
        mode: "sow_statement_of_work",
        name: "Statement of Work (SOW)",
        category: "legal",
        description: "Professional services or technology engagement contract with scope, deliverables, milestones, commercials, and governance.",
        defaultTargetWordCount: 4500,
        recommendedAgentRoles: ["Commercial Counsel", "Delivery Principal", "Risk & Compliance Lead"],
        defaultLenses: ["legal", "devils_advocate", "fact_check"],
        stations: [
            { stationKey: "project_overview_objectives", title: "1. Executive Summary & Objectives", description: "Business context, background recitals, and strategic objectives for the engagement.", targetPercentage: 0.10, suggestedScaffolding: "Start with the business outcome this engagement achieves, then provide context on why this work is being undertaken now." },
            { stationKey: "scope_in_out", title: "2. Scope (In-Scope / Out-of-Scope)", description: "Detailed in-scope activities and explicit out-of-scope exclusions.", targetPercentage: 0.15, suggestedScaffolding: "List each in-scope work package, then explicitly enumerate exclusions to prevent scope creep.", requiredClausesOrBeats: ["In-Scope Activities", "Out-of-Scope Exclusions"] },
            { stationKey: "deliverables_acceptance", title: "3. Deliverables & Acceptance Criteria", description: "Concrete work products, formats, and formal acceptance criteria.", targetPercentage: 0.15, suggestedScaffolding: "Define each deliverable with its format, quality standard, and acceptance threshold.", requiredClausesOrBeats: ["Deliverable Schedule Table", "Acceptance Process"] },
            { stationKey: "milestones_timeline", title: "4. Milestones, Timeline & Dependencies", description: "Project schedule, work breakdown structure, critical path, and external dependencies.", targetPercentage: 0.13, suggestedScaffolding: "Structure as a phased timeline with milestone gates. Identify the critical path and any client-side dependencies.", requiredClausesOrBeats: ["Milestone Table", "Dependencies"] },
            { stationKey: "staffing_governance_raci", title: "5. Staffing, Governance & RACI", description: "Staffing matrix, key personnel, client obligations, RACI responsibility assignment.", targetPercentage: 0.12, suggestedScaffolding: "Define the governance structure, key personnel from both parties, and a RACI matrix for major deliverables.", requiredClausesOrBeats: ["RACI Matrix", "Key Personnel Table"] },
            { stationKey: "commercials_payment_milestones", title: "6. Commercials & Payment Terms", description: "Pricing model (T&M / Fixed Fee / Blended), billing milestones, expense policy.", targetPercentage: 0.13, suggestedScaffolding: "Specify the pricing model, payment milestone schedule, invoicing terms, and expense reimbursement policy.", requiredClausesOrBeats: ["Fee Schedule", "Payment Milestone Table"] },
            { stationKey: "assumptions_risk_mitigation", title: "7. Assumptions & Risk Register", description: "Technical and operational assumptions, risk register with probability/impact/mitigation.", targetPercentage: 0.12, suggestedScaffolding: "Document assumptions that underpin the cost and timeline estimates. Flag risks with probability, impact, and mitigation strategies.", requiredClausesOrBeats: ["Assumptions List", "Risk Register Table"] },
            { stationKey: "change_control_sla", title: "8. Change Control, SLAs & Signature", description: "Scope change protocol, service level agreements, acceptance sign-off, and signature block.", targetPercentage: 0.10, suggestedScaffolding: "Define the change request process, applicable SLAs, and the formal sign-off and signature block.", requiredClausesOrBeats: ["Change Control Process", "Signature Block"] },
        ],
    },

    business_doc_best_practices: {
        mode: "business_doc_best_practices",
        name: "Business Documentation Best Practices (BABOK/TOGAF)",
        category: "business",
        description: "Comprehensive business case, requirements traceability, and enterprise architecture document aligned to BABOK and TOGAF standards.",
        defaultTargetWordCount: 5000,
        recommendedAgentRoles: ["Lead Business Architect", "Enterprise Strategist", "Governance SME"],
        defaultLenses: ["stylistic", "fact_check", "devils_advocate"],
        stations: [
            { stationKey: "executive_summary_context", title: "1. Strategic Vision & Problem Statement", description: "Strategic vision, problem statement, key stakeholders, and decision context.", targetPercentage: 0.12, suggestedScaffolding: "Open with the strategic imperative, then frame the problem in business terms. Identify the key stakeholders and the decision this document supports." },
            { stationKey: "current_vs_target_operating_model", title: "2. Current vs. Target Operating Model", description: "As-is workflow analysis vs. to-be Target Operating Model (TOM).", targetPercentage: 0.15, suggestedScaffolding: "Map the current-state process, pain points, and inefficiencies. Then describe the target-state operating model and the transformation required." },
            { stationKey: "requirements_traceability_matrix", title: "3. Requirements & Traceability Matrix", description: "Functional, non-functional, and integration requirements with traceability to business objectives.", targetPercentage: 0.15, suggestedScaffolding: "Enumerate requirements in a traceable structure: each requirement links to a business objective, has a priority, and an acceptance criterion.", requiredClausesOrBeats: ["Requirements Table", "Traceability Matrix"] },
            { stationKey: "stakeholder_impact_change_mgmt", title: "4. Stakeholder Impact & Change Management", description: "Organizational change readiness assessment, training plan, and communications strategy.", targetPercentage: 0.14, suggestedScaffolding: "Assess the impact on each stakeholder group. Define the change management approach, training requirements, and communications plan." },
            { stationKey: "financial_cost_benefit_roi", title: "5. Financial Appraisal (TCO, NPV, ROI)", description: "3-5 year Total Cost of Ownership, Net Present Value, payback period, and budget allocation.", targetPercentage: 0.16, suggestedScaffolding: "Build the financial case: TCO over the appraisal period, NPV calculation, payback period, and the budget request with allocation breakdown.", requiredClausesOrBeats: ["TCO Table", "NPV Calculation", "Budget Allocation"] },
            { stationKey: "risk_governance_compliance", title: "6. Risk, Governance & Compliance", description: "Regulatory compliance posture, security assessment, risk mitigation strategies.", targetPercentage: 0.14, suggestedScaffolding: "Identify regulatory and compliance requirements. Assess the risk profile and define mitigation strategies with owners and timelines.", requiredClausesOrBeats: ["Risk Matrix", "Compliance Checklist"] },
            { stationKey: "implementation_roadmap_okrs", title: "7. Roadmap, Milestones & OKRs", description: "Phased execution plan, milestone gates, KPIs, and OKR scorecards.", targetPercentage: 0.14, suggestedScaffolding: "Define the phased implementation roadmap with milestone gates, success metrics (KPIs), and OKR scorecards for each phase.", requiredClausesOrBeats: ["Roadmap Timeline", "OKR Scorecard"] },
        ],
    },

    enterprise_sop: {
        mode: "enterprise_sop",
        name: "Enterprise Standard Operating Procedure (SOP)",
        category: "business",
        description: "Standard Operating Procedure with compliance checkpoints, quality gates, and audit trail requirements.",
        defaultTargetWordCount: 3000,
        recommendedAgentRoles: ["Operations Controller", "Quality Assurance Auditor"],
        defaultLenses: ["fact_check", "stylistic", "note"],
        stations: [
            { stationKey: "purpose_scope_ownership", title: "1. Purpose, Scope & Ownership", description: "Objectives, applicable systems, organizational owner, and effective date.", targetPercentage: 0.15, suggestedScaffolding: "State the purpose of this SOP, which processes and systems it covers, the organizational owner, and the effective date." },
            { stationKey: "prerequisites_access", title: "2. Prerequisites & Access Requirements", description: "Systems, permissions, credentials, tools, and environmental setup required before execution.", targetPercentage: 0.12, suggestedScaffolding: "List every system, tool, permission, and credential required. Include environment setup steps if applicable." },
            { stationKey: "step_by_step_procedure", title: "3. Step-by-Step Procedure", description: "Sequenced execution steps with explicit expected outcomes and decision points.", targetPercentage: 0.30, suggestedScaffolding: "Number each step. Include the action, expected outcome, decision points, and any branching logic. Use screenshots or diagrams where helpful.", requiredClausesOrBeats: ["Numbered Steps", "Decision Points", "Expected Outcomes"] },
            { stationKey: "quality_assurance_exceptions", title: "4. QA Checks & Exception Handling", description: "Validation checks, edge cases, failure recovery, and escalation paths.", targetPercentage: 0.18, suggestedScaffolding: "Define the quality checkpoints, how to verify success, edge cases to watch for, failure recovery steps, and when to escalate.", requiredClausesOrBeats: ["QA Checklist", "Exception Handling Matrix"] },
            { stationKey: "compliance_audit_records", title: "5. Compliance & Audit Trail", description: "Logging requirements, retention policies, audit trail specifications.", targetPercentage: 0.13, suggestedScaffolding: "Specify what must be logged, where logs are stored, retention periods, and how auditors access the trail." },
            { stationKey: "revision_history_review", title: "6. Revision History & Review Cadence", description: "Version history, review cadence, approval sign-offs, and sunset criteria.", targetPercentage: 0.12, suggestedScaffolding: "Maintain a revision history table. Define the review cadence (e.g., quarterly), approval signatories, and conditions under which this SOP is retired.", requiredClausesOrBeats: ["Revision History Table", "Approval Sign-off"] },
        ],
    },

    // ── AI Governance Archetypes ────────────────────────────────────────────

    ai_system_governance: {
        mode: "ai_system_governance",
        name: "AI System Governance Policy",
        category: "legal",
        description: "Governance policy, compliance requirements, and ethical guidelines applicable to an AI system — the document a manuscript links via governance_policy_document_id.",
        defaultTargetWordCount: 4500,
        recommendedAgentRoles: ["AI Governance Lead", "Compliance Officer", "Responsible AI Reviewer"],
        defaultLenses: ["legal", "fact_check", "devils_advocate"],
        stations: [
            { stationKey: "purpose_scope", title: "1. Purpose, Scope & System Identification", description: "The AI system this policy governs (ai_system_id), intended use, and boundaries of applicability.", targetPercentage: 0.10, suggestedScaffolding: "Name the AI system by its registry id and describe what it does, for whom, and where this policy applies.", requiredClausesOrBeats: ["AI System Identifier", "Intended Use"] },
            { stationKey: "roles_accountability", title: "2. Roles, Accountability & Oversight", description: "Accountable owners, review board composition, escalation path, and separation of duties.", targetPercentage: 0.15, suggestedScaffolding: "Name the accountable owner, the review body, and the escalation path. Keep roles generic — attach people in the entity ledger.", requiredClausesOrBeats: ["Accountable Owner", "Review Board", "Escalation Path"] },
            { stationKey: "risk_classification", title: "3. Risk Classification & Regulatory Mapping", description: "Risk tier of the system and the regulations/frameworks it falls under (e.g. EU AI Act, NIST AI RMF, ISO/IEC 42001).", targetPercentage: 0.15, suggestedScaffolding: "State the risk tier with its rationale, then map to each applicable framework. Do not assert a regulation applies without the facts establishing it.", requiredClausesOrBeats: ["Risk Tier", "Framework Mapping Table"] },
            { stationKey: "data_governance", title: "4. Data Governance & Lineage Requirements", description: "Training/inference data rules, lineage documentation duties, retention, and access controls.", targetPercentage: 0.15, suggestedScaffolding: "Define the lineage record the system must maintain and link to the data_lineage_narrative document that provides it.", requiredClausesOrBeats: ["Lineage Requirements", "Retention & Access"] },
            { stationKey: "bias_fairness", title: "5. Bias, Fairness & Human Oversight", description: "Fairness obligations, bias testing cadence, human-in-the-loop requirements, and the link to the bias mitigation strategy document.", targetPercentage: 0.15, suggestedScaffolding: "State the fairness obligations and the testing cadence. Reference the companion bias_mitigation_strategy document for techniques.", requiredClausesOrBeats: ["Bias Testing Cadence", "Human Oversight Controls"] },
            { stationKey: "monitoring_incident_response", title: "6. Monitoring, Incident Response & Drift", description: "Production monitoring, incident severity tiers, reporting timelines, and model-drift handling.", targetPercentage: 0.12, suggestedScaffolding: "Define what is monitored, severity tiers for incidents, who is notified, and the reporting timeline.", requiredClausesOrBeats: ["Severity Tiers", "Reporting Timeline"] },
            { stationKey: "change_management_audit", title: "7. Change Management, Review & Audit Trail", description: "Versioning of the system and its documentation, review cadence, audit evidence, and approval workflow.", targetPercentage: 0.10, suggestedScaffolding: "Require that documentation changes go through revision history and review approval. Define the audit evidence retained.", requiredClausesOrBeats: ["Review Cadence", "Approval Workflow", "Audit Evidence"] },
            { stationKey: "appendix_definitions", title: "8. Definitions & References", description: "Defined terms, linked documents (lineage graph, bias strategy), and external standards referenced.", targetPercentage: 0.08, suggestedScaffolding: "List defined terms and link the companion documents by their Scribe document ids." },
        ],
    },

    data_lineage_narrative: {
        mode: "data_lineage_narrative",
        name: "AI Data Lineage Narrative",
        category: "business",
        description: "Human-readable account of how data flows into and through an AI system — provenance, transformation, consumers — with the lineage graph artifact embedded or linked.",
        defaultTargetWordCount: 3500,
        recommendedAgentRoles: ["Data Governance Analyst", "ML Platform Architect", "Privacy Officer"],
        defaultLenses: ["fact_check", "legal", "note"],
        stations: [
            { stationKey: "system_overview", title: "1. System Overview & Data Context", description: "The AI system identifier, what the system consumes and produces, and why lineage matters for it.", targetPercentage: 0.10, suggestedScaffolding: "Identify the AI system (ai_system_id) and summarize the data it depends on and emits." },
            { stationKey: "data_sources", title: "2. Data Sources & Provenance", description: "Each upstream source: origin, owner, collection method, consent/licensing basis.", targetPercentage: 0.18, suggestedScaffolding: "Enumerate every source with its origin, steward, and the legal basis for its use.", requiredClausesOrBeats: ["Source Inventory Table", "Legal Basis"] },
            { stationKey: "ingestion_preprocessing", title: "3. Ingestion & Preprocessing", description: "How raw data is validated, cleaned, labelled, and versioned before training or inference.", targetPercentage: 0.15, suggestedScaffolding: "Describe each transformation stage and where its output lands. Note dataset versions." },
            { stationKey: "lineage_graph", title: "4. Lineage Graph", description: "The structured flow: sources → transformations → datasets → model → consumers. Embed a Mermaid diagram or structured JSON.", targetPercentage: 0.15, suggestedScaffolding: "Include a Mermaid flowchart (```mermaid) or a JSON node/edge list covering every hop from source to consumer.", requiredClausesOrBeats: ["Lineage Diagram"] },
            { stationKey: "training_inference_flow", title: "5. Training & Inference Data Flow", description: "Which data reaches model training, evaluation, and live inference — and which is excluded.", targetPercentage: 0.15, suggestedScaffolding: "Separate training-time flow from inference-time flow, and name any data deliberately excluded." },
            { stationKey: "downstream_consumers", title: "6. Downstream Consumers & Outputs", description: "Jobs, knowledge graphs, missions, and external systems that consume the system's outputs.", targetPercentage: 0.12, suggestedScaffolding: "List each consumer and what it does with the output; this is the impact surface for lineage changes." },
            { stationKey: "retention_access_controls", title: "7. Retention, Access & Change Control", description: "Retention periods, access boundaries, and how lineage is updated when sources change.", targetPercentage: 0.10, suggestedScaffolding: "State retention per source and the change-control step that updates this document when a source or transform changes." },
            { stationKey: "open_questions_gaps", title: "8. Known Gaps & Open Questions", description: "Undocumented hops, unverified provenance, and the questions reviewers should chase.", targetPercentage: 0.05, suggestedScaffolding: "Be explicit about what is not yet traced. An honest gap list is the audit's starting point." },
        ],
    },

    bias_mitigation_strategy: {
        mode: "bias_mitigation_strategy",
        name: "AI Bias Mitigation Strategy",
        category: "legal",
        description: "The strategies employed to identify, measure, and mitigate biases for an AI system — linked from a manuscript via bias_mitigation_strategy_document_id.",
        defaultTargetWordCount: 3500,
        recommendedAgentRoles: ["Responsible AI Reviewer", "Fairness Researcher", "Domain SME"],
        defaultLenses: ["legal", "fact_check", "devils_advocate"],
        stations: [
            { stationKey: "system_context_use", title: "1. System Context & Intended Use", description: "The AI system identifier, the decisions it influences, and the populations it affects.", targetPercentage: 0.12, suggestedScaffolding: "Name the AI system (ai_system_id), the decisions it informs, and the affected populations." },
            { stationKey: "protected_attributes_risk", title: "2. Protected Attributes & Risk Taxonomy", description: "Attributes in scope (race, gender, age, disability…), harm categories, and severity ranking.", targetPercentage: 0.15, suggestedScaffolding: "List protected attributes relevant to the domain and the harm taxonomy (allocation, representation, quality-of-service harms).", requiredClausesOrBeats: ["Protected Attributes", "Harm Taxonomy"] },
            { stationKey: "known_bias_sources", title: "3. Known Bias Sources", description: "Where bias enters: sampling, labelling, historical data, proxy features, feedback loops.", targetPercentage: 0.15, suggestedScaffolding: "Walk each stage of the pipeline and name the bias mechanism plausibly present — do not assert measured findings that were not measured." },
            { stationKey: "measurement_evaluation", title: "4. Measurement & Evaluation", description: "Fairness metrics, evaluation datasets, disaggregated performance analysis, and test cadence.", targetPercentage: 0.18, suggestedScaffolding: "Name the metrics (e.g. demographic parity, equalized odds) with the reason each applies, the evaluation data, and how often tests run.", requiredClausesOrBeats: ["Fairness Metrics", "Evaluation Cadence"] },
            { stationKey: "mitigation_techniques", title: "5. Mitigation Techniques Applied", description: "Pre/in/post-processing mitigations actually in place, each with its evidence and limitations.", targetPercentage: 0.18, suggestedScaffolding: "For each mitigation, state where in the pipeline it applies, the evidence it works, and its known limitations.", requiredClausesOrBeats: ["Technique Inventory", "Evidence & Limitations"] },
            { stationKey: "residual_risk_monitoring", title: "6. Residual Risk & Ongoing Monitoring", description: "Risks that remain after mitigation, drift signals, and alert thresholds.", targetPercentage: 0.12, suggestedScaffolding: "State what residual risk is accepted, by whom, and the monitoring that would catch its growth." },
            { stationKey: "escalation_review", title: "7. Escalation, Review & Re-Approval", description: "Who is notified on a bias finding, the re-review trigger, and linkage to the governance policy.", targetPercentage: 0.10, suggestedScaffolding: "Define the escalation path and the trigger conditions for re-review. Link the governance_policy document for the approval workflow.", requiredClausesOrBeats: ["Escalation Path", "Re-Review Triggers"] },
        ],
    },
};

export function getFramework(mode: ScribeArchetypeMode): ScribeFrameworkDefinition {
    return SCRIBE_FRAMEWORKS[mode] || SCRIBE_FRAMEWORKS.freeform;
}

