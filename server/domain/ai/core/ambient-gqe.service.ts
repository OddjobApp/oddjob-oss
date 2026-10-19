/**
 * Ambient Good Question Engine (Ambient GQE) Service
 *
 * Generates proactive, station-specific contextual questions with quick-select
 * answer chips for nonlinear manuscript and document authoring.
 */

import { ScribeArchetypeMode } from "@shared/schema/scribe.js";
import { SCRIBE_FRAMEWORKS } from "@server/domain/scribe/frameworks/index.js";

export interface AmbientGQEQuestion {
    questionId: string;
    stationKey: string;
    /** The conversational question prompt */
    question: string;
    /** Chip options for one-click selection */
    quickOptions?: string[];
    /** Whether the user's drafted content or entities already answer this */
    isResolved: boolean;
    /** Priority rating (1–10) */
    priority: number;
    /** Template to scaffold the chosen option into prose */
    scaffoldingTemplate?: string;
}

export interface AmbientStationQuestionBank {
    [stationKey: string]: Array<{
        questionId: string;
        question: string;
        quickOptions?: string[];
        keywordsToCheck: string[];
        priority: number;
        scaffoldingTemplate?: string;
    }>;
}

const FRAMEWORK_QUESTION_BANKS: Record<string, AmbientStationQuestionBank> = {
    sow_statement_of_work: {
        project_overview_objectives: [
            {
                questionId: "sow_obj_1",
                question: "What is the primary business outcome this project achieves?",
                quickOptions: ["Cloud Modernization", "Operational Efficiency", "Cost Reduction", "Security Hardening", "Regulatory Compliance"],
                keywordsToCheck: ["outcome", "objective", "goal", "modernization", "efficiency"],
                priority: 9,
                scaffoldingTemplate: "The primary objective of this engagement is to deliver {option} across the enterprise footprint.",
            },
            {
                questionId: "sow_obj_2",
                question: "Who is the primary business sponsor or client entity?",
                quickOptions: ["Acme Corp", "Enterprise Operations", "CTO Office", "IT Steering Committee"],
                keywordsToCheck: ["sponsor", "stakeholder", "client", "customer"],
                priority: 8,
                scaffoldingTemplate: "This project is sponsored by {option}.",
            },
        ],
        scope_in_out: [
            {
                questionId: "sow_scope_out",
                question: "What activities are explicitly out of scope?",
                quickOptions: ["End-User Training", "Legacy Data Migration", "Hardware Procurement", "Third-Party Licences", "Custom Mobile App"],
                keywordsToCheck: ["out of scope", "excluded", "exclusion", "not included", "out-of-scope"],
                priority: 10,
                scaffoldingTemplate: "The following activities are explicitly excluded from this engagement: {option}.",
            },
            {
                questionId: "sow_scope_in",
                question: "What are the core technical systems in scope?",
                quickOptions: ["Production Cloud Infrastructure", "API Microservices", "Database Migration", "CI/CD Pipeline"],
                keywordsToCheck: ["in scope", "included", "systems", "architecture"],
                priority: 9,
                scaffoldingTemplate: "The direct scope of work includes architecture and deployment of {option}.",
            },
        ],
        deliverables_acceptance: [
            {
                questionId: "sow_deliv_criteria",
                question: "What constitutes formal acceptance for key deliverables?",
                quickOptions: ["5 Business Days Review", "Automated QA Test Suite Passing", "Executive Sign-Off", "Zero Critical Defects"],
                keywordsToCheck: ["acceptance", "sign-off", "criteria", "acceptance period", "rejection"],
                priority: 9,
                scaffoldingTemplate: "Formal acceptance will occur upon {option} following delivery.",
            },
        ],
        milestones_timeline: [
            {
                questionId: "sow_milestone_count",
                question: "How many major delivery phases or milestones?",
                quickOptions: ["2 Phases (Discovery + Execution)", "3 Milestones (Plan, Build, Cutover)", "4 Sprints", "Agile Bi-Weekly"],
                keywordsToCheck: ["milestone", "phase", "timeline", "duration", "weeks"],
                priority: 9,
                scaffoldingTemplate: "Project delivery is structured into {option}.",
            },
        ],
        commercials_payment_milestones: [
            {
                questionId: "sow_pricing_model",
                question: "What is the commercial billing structure?",
                quickOptions: ["Fixed Fee (Milestone-based)", "Time & Materials (T&M)", "Monthly Retainer", "Blended Rate"],
                keywordsToCheck: ["fixed fee", "time and materials", "t&m", "billing", "rate", "commercials"],
                priority: 10,
                scaffoldingTemplate: "Services will be invoiced on a {option} basis with net-30 payment terms.",
            },
        ],
        assumptions_risk_mitigation: [
            {
                questionId: "sow_assumptions",
                question: "What key dependencies or client assumptions exist?",
                quickOptions: ["Timely Cloud Access", "Existing Documentation Accuracy", "SME Availability", "Staging Environment Ready"],
                keywordsToCheck: ["assumption", "dependency", "client obligation", "access"],
                priority: 8,
                scaffoldingTemplate: "This engagement relies on the following key assumption: {option}.",
            },
        ],
        change_control_sla: [
            {
                questionId: "sow_change_mgmt",
                question: "What is the formal change order turnaround time?",
                quickOptions: ["3 Business Days", "5 Business Days", "Weekly Review Board", "10 Business Days"],
                keywordsToCheck: ["change control", "change request", "cr", "sla", "turnaround"],
                priority: 7,
                scaffoldingTemplate: "Any modifications to scope or budget require a written Change Order reviewed within {option}.",
            },
        ],
    },

    business_doc_best_practices: {
        executive_summary_context: [
            {
                questionId: "biz_problem",
                question: "What strategic problem or market opportunity triggered this case?",
                quickOptions: ["Legacy System Inefficiencies", "Competitive Disruption", "Revenue Growth Opportunity", "Regulatory Compliance Mandate"],
                keywordsToCheck: ["problem", "opportunity", "driver", "rationale"],
                priority: 10,
                scaffoldingTemplate: "This initiative is initiated to address {option}.",
            },
        ],
        financial_cost_benefit_roi: [
            {
                questionId: "biz_roi_timeline",
                question: "What is the target payback horizon or hurdle rate?",
                quickOptions: ["12 Months Payback", "18 Months Payback", "24 Months Payback", "> 35% IRR"],
                keywordsToCheck: ["payback", "roi", "irr", "npv", "financial", "hurdle"],
                priority: 9,
                scaffoldingTemplate: "The projected economic investment yields an estimated {option}.",
            },
        ],
    },

    enterprise_sop: {
        purpose_scope_ownership: [
            {
                questionId: "sop_owner",
                question: "Who is the primary operational owner for this SOP?",
                quickOptions: ["DevOps / SRE Team", "Security Operations (SecOps)", "Database Administration", "Platform Engineering"],
                keywordsToCheck: ["owner", "ownership", "responsible", "team", "raci"],
                priority: 10,
                scaffoldingTemplate: "This standard operating procedure is owned and maintained by the {option}.",
            },
        ],
        prerequisites_access: [
            {
                questionId: "sop_access_req",
                question: "What privileged access or tools are required before execution?",
                quickOptions: ["VPN & Bastion Host", "Production Read/Write IAM Role", "MFA Token & Approval Ticket", "Kubernetes Admin Context"],
                keywordsToCheck: ["prerequisite", "access", "iam", "credential", "permission"],
                priority: 9,
                scaffoldingTemplate: "Operators must possess active {option} prior to starting this procedure.",
            },
        ],
    },
};

export class AmbientGQEService {
    /**
     * Generates active question prompts for a specific station, checking if
     * existing content or extracted entities have already satisfied the prompt.
     */
    generateStationQuestions(
        archetypeMode: ScribeArchetypeMode,
        stationKey: string,
        currentContent: string = "",
        extractedEntities: Record<string, string> = {}
    ): AmbientGQEQuestion[] {
        const frameworkBank = FRAMEWORK_QUESTION_BANKS[archetypeMode] || FRAMEWORK_QUESTION_BANKS.sow_statement_of_work;
        const stationQuestions = frameworkBank[stationKey] || [];
        const contentLower = currentContent.toLowerCase();

        if (stationQuestions.length === 0) {
            // Provide intelligent fallback question based on framework station description
            const framework = SCRIBE_FRAMEWORKS[archetypeMode];
            const station = framework?.stations?.find((s) => s.stationKey === stationKey);
            if (station) {
                return [
                    {
                        questionId: `fallback_${stationKey}`,
                        stationKey,
                        question: `What key details belong in "${station.title}"?`,
                        quickOptions: ["Standard Industry Terms", "Detailed Specifications", "Bullet Summary", "Executive Context"],
                        isResolved: currentContent.trim().length > 150,
                        priority: 5,
                        scaffoldingTemplate: `For ${station.title}, the primary consideration is {option}.`,
                    },
                ];
            }
            return [];
        }

        return stationQuestions.map((q) => {
            // Check if keywords already exist in the text or entities
            const isResolved = q.keywordsToCheck.some(
                (kw) =>
                    contentLower.includes(kw) ||
                    Object.values(extractedEntities).some((val) => val.toLowerCase().includes(kw))
            );

            return {
                questionId: q.questionId,
                stationKey,
                question: q.question,
                quickOptions: q.quickOptions,
                isResolved,
                priority: q.priority,
                scaffoldingTemplate: q.scaffoldingTemplate,
            };
        });
    }
}

export const ambientGqeService = new AmbientGQEService();
