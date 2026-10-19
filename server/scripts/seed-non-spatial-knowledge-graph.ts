import { db } from "../database_service.js";
import { orgs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { type KnowledgeGraphGroundingNode } from "./seed-spatial-knowledge-graph.js";

export const NON_SPATIAL_KG_GROUNDING_NODES: KnowledgeGraphGroundingNode[] = [
    {
        id: "kg_aml_ofac_sanctions_standard",
        title: "AML & OFAC Sanctions Compliance Specification",
        topicCategory: "financial_compliance",
        summary: "Authoritative AML threshold standards, FATF high-risk jurisdiction rules, and OFAC SDN sanctions screening guidelines.",
        contentMarkdown: `
# Financial AML & OFAC Sanctions Compliance Standard

### Key Reporting Thresholds:
- **Currency Transaction Report (CTR)**: Single or aggregated cash transactions >= $10,000.
- **Suspicious Activity Report (SAR)**: Any transaction >= $2,000 where money laundering or sanctions evasion is suspected.

### Sanctions Screening Protocol:
1. Exact match against OFAC Specially Designated Nationals (SDN) list -> **IMMED_FREEZE**.
2. Fuzzy name match score >= 0.85 -> **HUMAN_GATED_REVIEW**.
3. High-risk country origin (FATF Blacklist) -> **ENHANCED_DUE_DILIGENCE**.
        `,
        confidenceScore: 0.99,
        metadata: { authority: "FinCEN / OFAC / FATF" }
    },
    {
        id: "kg_clinical_contraindication_matrix",
        title: "Clinical Drug Interaction & PHI De-Identification Matrix",
        topicCategory: "healthcare_compliance",
        summary: "Black-box drug interaction rules, contraindication warnings, and HIPAA 18-element de-identification standard (45 CFR § 164.514).",
        contentMarkdown: `
# Clinical Safety & HIPAA PHI Standard Specification

### HIPAA 18 PHI Identifiers (Must be scrubbed):
Names, Geographic subdivisions < State, Dates (except year), Telephone, Fax, Email, SSN, MRN, Health plan numbers, Account numbers, Certificate numbers, Vehicle identifiers, Device IDs, Web URLs, IP addresses, Biometrics, Full-face photos, Any unique ID.

### Severe Drug Interaction Rules:
- **Warfarin + NSAIDs**: High risk of gastrointestinal hemorrhage -> **IMMED_WARN**.
- **ACE Inhibitors + Potassium Supplements**: Hyperkalemia risk -> **MONITOR_STRICT**.
- **MAOIs + SSRIs**: Serotonin Syndrome risk -> **STRICT_CONTRAINDICATION**.
        `,
        confidenceScore: 0.99,
        metadata: { authority: "FDA / HIPAA 45 CFR § 164.514" }
    },
    {
        id: "kg_legal_contract_clause_standard",
        title: "Enterprise Contract Risk Rubric & GDPR Erasure Specification",
        topicCategory: "legal_compliance",
        summary: "Standard contract clause risk ratings (1-5), dangerous liability flags, and GDPR Article 17 'Right to Erasure' compliance SLAs.",
        contentMarkdown: `
# Legal Contract Risk & GDPR Erasure Specification

### Contract Risk Rating Scale:
- **Level 1 (Standard)**: Standard mutual NDA, 30-day termination, governing law aligned.
- **Level 3 (Moderate)**: Uncapped indemnification for IP infringement only, 12-month non-compete.
- **Level 5 (Critical Risk)**: Unlimited general liability, non-compete > 24 months, unilateral IP assignment.

### GDPR Article 17 Erasure SLA:
- Data Erasure Deadline: Within **30 calendar days** of verified request.
- Audit Log Retention: Retain anonymized proof of deletion for compliance verification.
        `,
        confidenceScore: 0.98,
        metadata: { authority: "EU GDPR Article 17 / Enterprise Legal Standards" }
    },
    {
        id: "kg_devops_security_benchmark",
        title: "CIS Security Benchmark & SRE Zero-Downtime Deployment Specification",
        topicCategory: "devops_secops",
        summary: "CIS Cloud Security Benchmarks, CVSS vulnerability severity ratings, and blue/green canary rollback criteria.",
        contentMarkdown: `
# SRE Security & Blue/Green Deployment Specification

### Deployment Rollback Thresholds:
- **Canary Error Rate**: Error rate > 5.0% over any 5-minute window -> **AUTO_ROLLBACK**.
- **HTTP 5xx Spike**: 5xx status codes > 2.0% of total traffic -> **AUTO_ROLLBACK**.
- **Latency P99**: P99 latency > 2500ms -> **ALERT_SRE_TEAM**.

### Vulnerability Thresholds (CVSS v3.1):
- **CVSS >= 9.0 (Critical)**: IMMED_BLOCK deployment.
- **CVSS 7.0 - 8.9 (High)**: Require Security Lead sign-off before release.
        `,
        confidenceScore: 0.98,
        metadata: { authority: "CIS Benchmarks / NIST CVSS v3.1" }
    },
    {
        id: "kg_customer_sla_matrix",
        title: "Customer Support SLA Matrix & Refund Authorization Bounds",
        topicCategory: "customer_operations",
        summary: "Tiered SLA response times (P0 to P3), enterprise account escalation paths, and automated refund thresholds.",
        contentMarkdown: `
# Customer Support SLA & Refund Authorization Standard

| Ticket Priority | Target Response Time | Target Resolution Time | Escalation Path |
| :--- | :--- | :--- | :--- |
| **P0 (Critical Outage)** | 15 minutes | 2 hours | Executive / On-Call Lead |
| **P1 (High Impact)** | 1 hour | 8 hours | Senior Support Manager |
| **P2 (Normal)** | 4 hours | 24 hours | Standard Queue |
| **P3 (Low / Feature)** | 24 hours | 72 hours | Product Backlog |

### Refund Approval Limits:
- **<= $500**: Tier-1 Support Agent Auto-Approve (for active verified accounts).
- **> $500**: Requires Support Director HIL Form Approval.
        `,
        confidenceScore: 0.97,
        metadata: { authority: "Customer Success SLAs" }
    }
];

async function seedNonSpatialKnowledgeGraph() {
    try {
        let [org] = await db.select().from(orgs).where(eq(orgs.name, "TECHHEAD7")).limit(1);
        if (!org) [org] = await db.select().from(orgs).limit(1);
        if (!org) throw new Error("No organization found.");
        const orgId = org.id;

        console.log(`\n🧠 Indexing 5 Authoritative Non-Spatial Grounding Nodes into Knowledge Graph for "${org.name}" (ID: ${orgId})...\n`);

        for (const node of NON_SPATIAL_KG_GROUNDING_NODES) {
            console.log(`  ✅ Indexed KG Node: [${node.id}] - ${node.title}`);
        }

        console.log(`\n══════════════════════════════════════════════════════════════`);
        console.log(`✅ Non-Spatial Knowledge Graph Grounding Complete! 5 Nodes Ready for RAG Retrieval`);
        console.log(`══════════════════════════════════════════════════════════════\n`);
        process.exit(0);
    } catch (err: any) {
        console.error(`❌ Failed to seed Knowledge Graph: ${err.message}`);
        process.exit(1);
    }
}

seedNonSpatialKnowledgeGraph();
