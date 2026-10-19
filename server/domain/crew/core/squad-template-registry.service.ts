/**
 * Curated Hybrid Squad Template Registry Service
 *
 * Provides pre-configured, production-ready hybrid agent squad combinations
 * for common enterprise archetypes with verified capability bounds and quorum policies.
 */

export interface SquadMemberDefinition {
    agentId: string;
    displayName: string;
    role: string;
    isLead?: boolean;
    requiredTools: string[];
    finopsTier: "fast_slm" | "balanced" | "frontier_reasoning";
}

export interface SquadTemplate {
    id: string;
    name: string;
    slug: string;
    description: string;
    category: "engineering" | "security" | "governance" | "research" | "product";
    quorumPolicy: "squad_lead_only" | "majority" | "unanimous";
    members: SquadMemberDefinition[];
    suggestedMaxTokens: number;
    recommendedCycleType: string;
}

export class SquadTemplateRegistryService {
    private templates = new Map<string, SquadTemplate>();

    constructor() {
        this.registerDefaultTemplates();
    }

    private registerDefaultTemplates(): void {
        const defaultTemplates: SquadTemplate[] = [
            {
                id: "tmpl_rapid_proto",
                name: "Rapid Prototyping Squad",
                slug: "rapid-prototyping",
                description: "High-velocity team for generating fullstack prototypes and reactive UI components in minutes.",
                category: "engineering",
                quorumPolicy: "squad_lead_only",
                suggestedMaxTokens: 8000,
                recommendedCycleType: "sprint",
                members: [
                    { agentId: "agt_lead_arch", displayName: "Marcus", role: "Lead Systems Architect", isLead: true, requiredTools: ["ast_parser", "schema_validator"], finopsTier: "frontier_reasoning" },
                    { agentId: "agt_fullstack", displayName: "Dev-NextJS", role: "Fullstack React Specialist", requiredTools: ["code_gen", "vitest_runner"], finopsTier: "frontier_reasoning" },
                    { agentId: "agt_ui_designer", displayName: "Pixel", role: "Design Token Specialist", requiredTools: ["tailwind_compiler"], finopsTier: "fast_slm" },
                ],
            },
            {
                id: "tmpl_forensic_redteam",
                name: "Forensic Red-Team Squad",
                slug: "forensic-redteam",
                description: "Adversarial security analysis, IAM privilege inspection, and zero-trust audit verification.",
                category: "security",
                quorumPolicy: "unanimous",
                suggestedMaxTokens: 6000,
                recommendedCycleType: "audit",
                members: [
                    { agentId: "agt_sec_lead", displayName: "Aegis", role: "Chief Security Auditor", isLead: true, requiredTools: ["iam_inspector", "secret_store_validator"], finopsTier: "frontier_reasoning" },
                    { agentId: "agt_penteser", displayName: "Pen-Bot", role: "Adversarial Red-Teamer", requiredTools: ["injection_simulator"], finopsTier: "balanced" },
                    { agentId: "agt_compliance", displayName: "Governor", role: "Zero-Trust Policy Enforcer", requiredTools: ["redactor_engine"], finopsTier: "fast_slm" },
                ],
            },
            {
                id: "tmpl_compliance_quorum",
                name: "Compliance & Governance Quorum",
                slug: "compliance-quorum",
                description: "Multi-stakeholder sign-off for enterprise risk, EU AI Act compliance, and spend governance.",
                category: "governance",
                quorumPolicy: "majority",
                suggestedMaxTokens: 5000,
                recommendedCycleType: "governance",
                members: [
                    { agentId: "agt_legal_tech", displayName: "Justitia", role: "Legal Tech Counsel", isLead: true, requiredTools: ["policy_evaluator"], finopsTier: "frontier_reasoning" },
                    { agentId: "agt_finops", displayName: "Comptroller", role: "FinOps Spend Comptroller", requiredTools: ["budget_ledger"], finopsTier: "balanced" },
                ],
            },
            {
                id: "tmpl_deep_research",
                name: "Deep Research & Intelligence Squad",
                slug: "deep-research",
                description: "Multi-tier recursive web exploration, citation grounding, and executive brief synthesis.",
                category: "research",
                quorumPolicy: "squad_lead_only",
                suggestedMaxTokens: 10000,
                recommendedCycleType: "research",
                members: [
                    { agentId: "agt_res_lead", displayName: "Curie", role: "Principal Research Analyst", isLead: true, requiredTools: ["web_search", "citation_grounder"], finopsTier: "frontier_reasoning" },
                    { agentId: "agt_data_viz", displayName: "Graphix", role: "Data Visualization Specialist", requiredTools: ["chart_renderer"], finopsTier: "fast_slm" },
                    { agentId: "agt_exec_writer", displayName: "Brief-Bot", role: "Executive Communications Writer", requiredTools: ["markdown_formatter"], finopsTier: "balanced" },
                ],
            },
        ];

        defaultTemplates.forEach(t => this.templates.set(t.slug, t));
    }

    public listTemplates(): SquadTemplate[] {
        return Array.from(this.templates.values());
    }

    public getTemplate(slug: string): SquadTemplate | undefined {
        return this.templates.get(slug);
    }
}

export const squadTemplateRegistry = new SquadTemplateRegistryService();
