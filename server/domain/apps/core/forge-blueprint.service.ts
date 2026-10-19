
import path from "node:path";
import fs from "node:fs/promises";
import { createLogger } from "@server/utils/logger.js";
import { withAiTimeout } from "./forge-utils.js";

const logger = createLogger("ForgeBlueprintService");
const BLUEPRINT_ROOT = path.resolve("server/blueprints/apps");

export interface ForgeOptions {
    description: string;
    organizationId?: number;
    [key: string]: any;
}

export type BlueprintMaturity = "stable" | "beta" | "experimental";

/**
 * How far each catalog blueprint can be relied on, from evidence in this repository:
 *
 * - stable: used by a cycle, so the blueprint contract test gates it, and has its
 *   own tests (rescue-dispatch's suite, tests/sdlc-workbench for sdlc-workbench and
 *   wayfare).
 * - beta: used by a cycle, so the contract test gates it, without dedicated tests.
 * - experimental: in no cycle — starter templates, demos and stubs.
 *
 * Anything not listed is experimental. This replaces a formalVerification flag that
 * claimed "MaxSMT & WCAG AA PASSED" for every entry without anything having run.
 */
export const BLUEPRINT_MATURITY: Record<string, BlueprintMaturity> = {
    "rescue-dispatch": "stable",
    "sdlc-workbench": "stable",
    "wayfare": "stable",

    "agent-training-workbench": "beta",
    "ai-workforce-dashboard": "beta",
    "budgetmaster-advisor": "beta",
    "budgetmaster-workbench": "beta",
    "codegen-pipeline-workbench": "beta",
    "it-ticketing-portal": "beta",
    "location-search": "beta",
    "ops-workbench": "beta",
    "pm-workbench": "beta",
    "product-launch-workbench": "beta",
    "qa-workbench": "beta",
    "research-workbench": "beta",
    "sales-opportunity-workbench": "beta",
    "scrum-master-workbench": "beta",
    "stakeholder-workbench": "beta",
    "support-agent-dashboard": "beta",
};

export class ForgeBlueprintService {
    /**
     * Smart Blueprint Selection
     */
    async selectBlueprint(description: string, defaultSlug: string): Promise<string> {
        const BLUEPRINT_MAP: Record<string, string[]> = {
            "analytics-dashboard": ["analytics", "dashboard", "chart", "graph", "metrics", "stats", "kpi", "data", "report", "monitor", "trend", "insight", "performance", "realtime", "bi", "business intelligence"],
            "ai-workforce-dashboard": ["workforce", "agents", "fleet", "ai workforce", "agent monitoring", "agent analytics"],
            "agent-training-workbench": ["training", "eval", "evaluation", "fine-tune", "dataset training", "prompt engineering"],
            "chat-assistant": ["chat", "assistant", "conversation", "gpt", "ai", "llm", "support", "bot", "message", "copilot", "help", "qa", "question answer"],
            "chat-assistant-v2": ["crew", "multi-agent", "collaboration", "war room", "governed chat", "socratic chat"],
            "crud-app": ["crud", "crm", "contacts", "leads", "sales", "pipeline", "deal", "customer", "account", "prospect", "table", "list", "records", "manage", "tracker", "inventory", "directory"],
            "api": ["api", "endpoint", "rest", "graphql", "webhook", "integration", "backend", "service", "routes", "proxy", "headless", "microservice", "middleware"],
            "spa": ["spa", "single page", "web app", "portal", "platform", "tool", "utility", "internal tool", "app", "application"],
            "pwa": ["pwa", "progressive", "mobile", "installable", "offline", "native", "home screen", "push notification"],
            "rescue-dispatch": ["dispatch", "rescue", "emergency", "ticket", "incident", "alert", "on-call", "map", "location", "geo", "coordinate", "route", "navigation", "spatial", "h3"],
            "mission-supervisor": ["mission", "supervisor", "task", "workflow", "agent", "pipeline", "automation", "orchestration", "job", "run", "trace"],
            "ops-workbench": ["operations", "incident management", "triage", "sla", "ops", "runbook"],
            "incident-response-workbench": ["incident response", "incident timeline", "incident commander", "recovery evidence"],
            "sdlc-workbench": ["sdlc", "software lifecycle", "git", "pull request", "code review", "cicd", "repository"],
            "codegen-pipeline-workbench": ["codegen", "code generation", "compiler", "ast", "scaffold generator"],
            "devops-workbench": ["devops", "infrastructure", "kubernetes", "docker", "terraform", "cloud deploy"],
            "qa-workbench": ["qa", "testing", "e2e", "flaky", "test suite", "playwright", "vitest", "quality assurance"],
            "industrial-dashboard": ["iot", "scada", "telemetry", "factory", "sensors", "hardware", "machinery", "industrial"],
            "location-search": ["geo search", "proximity", "places", "poi", "radius search", "geofence"],
            "budgetmaster-workbench": ["budget", "finance", "expense", "burn rate", "cost optimization", "accounting"],
            "budgetmaster-advisor": ["financial advisor", "portfolio", "investment", "cost forecast"],
            "it-ticketing-portal": ["it helpdesk", "servicedesk", "tickets", "hardware request", "access control"],
            "pm-workbench": ["product manager", "roadmap", "backlog", "user stories", "epics", "feature planning"],
            "product-launch-workbench": ["launch", "go to market", "gtm", "release checklist", "announcements"],
            "react-native": ["mobile app", "react native", "ios app", "android app", "cross platform"],
            "research-workbench": ["research", "literature", "arxiv", "paper analysis", "academic", "deep dive"],
            "sales-opportunity-workbench": ["sales pipeline", "lead qualification", "crm deal", "quotation"],
            "scrum-master-workbench": ["scrum", "sprint", "velocity", "standup", "burndown", "agile ceremony"],
            "stakeholder-workbench": ["stakeholder", "executive briefing", "kpi summary", "investor report"],
            "support-agent-dashboard": ["customer support", "zendesk", "omnichannel", "csat", "ticket resolution"],
            "wayfare": ["travel", "itinerary", "booking", "logistics", "trip planning"],
            "go-backend": ["go", "gin", "golang", "fiber", "go-backend", "go backend"],
            "python-backend": ["python", "fastapi", "django", "flask", "python-backend", "python backend"],
            "java-backend": ["java", "spring", "springboot", "maven", "java-backend", "java backend"],
        };

        const descLower = description.toLowerCase();
        let bestMatch = defaultSlug;
        let bestScore = 0;

        for (const [blueprintSlug, keywords] of Object.entries(BLUEPRINT_MAP)) {
            const score = keywords.filter(kw => descLower.includes(kw)).length;
            if (score > bestScore) {
                bestScore = score;
                bestMatch = blueprintSlug;
            }
        }

        if (bestScore >= 2) return bestMatch;

        try {
            const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");
            const classifyPrompt = `You are a blueprint classifier. Given an app description, return ONLY the best matching blueprint slug from this exact list: ${Object.keys(BLUEPRINT_MAP).join(", ")}

App description: ${description}

Return ONLY the slug, nothing else.`;

            // Use cost-optimized SLM routing — blueprint classification is a low-stakes
            // task that runs cheaply on a local model (llama3.2, phi3, etc.)
            const suggested = await systemAiService.getOptimalModelForTask(
                'blueprint-classify',
                classifyPrompt,
                { temperature: 0.0 }
            );
            const normalized = suggested?.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
            if (normalized && BLUEPRINT_MAP[normalized]) return normalized;
        } catch (err: any) {
            logger.warn(`AI classification failed: ${err.message}`);
        }

        return bestMatch;
    }

    /**
     * Scans for {{SLOT_NAME}} patterns.
     */
    detectSlots(snapshot: Record<string, string>): Record<string, string[]> {
        const slots: Record<string, string[]> = {};
        const SLOT_REGEX = /\{\{([A-Z0-9_]+)\}\}/g;

        for (const [filename, content] of Object.entries(snapshot)) {
            const matches = [...content.matchAll(SLOT_REGEX)];
            if (matches.length > 0) {
                slots[filename] = [...new Set(matches.map(m => m[1]))];
            }
        }
        return slots;
    }

    /**
     * Replaces {{SLOT_NAME}} tokens with intelligent fallback defaulting
     * to ensure generated code never contains dangling placeholders or unparsed tokens.
     */
    fillSlots(template: string, slots: Record<string, any> = {}): string {
        let result = template;

        // 1. Fill explicitly provided slot values
        for (const [key, value] of Object.entries(slots)) {
            if (value === undefined || value === null) continue;
            const replacement = typeof value === 'string' ? value : JSON.stringify(value);
            const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            result = result.replace(new RegExp('\\{\\{' + escapedKey + '\\}\\}', 'g'), replacement);
        }

        // 2. Intelligent Defaulting dictionary for common blueprint slots
        const DEFAULT_SLOT_RESOLVERS: Record<string, string | (() => string)> = {
            AGENT_ID: "1",
            AGENT_NAME: '"Governed AI Assistant"',
            PERSONA_NAME: '"Operations Co-Pilot"',
            APP_TITLE: '"AI Operations Assistant"',
            COLLECTION_NAME: '"chat_history"',
            HERO_STATS: "[]",
            HERO_CHART_DATA: "[]",
            INITIAL_MESSAGES: JSON.stringify([
                { role: "assistant", content: "Hello! How can I assist you with your operations today?" }
            ]),
            SUGGESTED_PROMPTS: JSON.stringify([
                "Show telemetry overview",
                "Review active incidents",
                "Simulate route optimization",
                "Explain latest policy check"
            ]),
            API_BASE_URL: '"/api"',
            PRIMARY_METRIC: '"Operational Velocity"',
            TITLE: '"Operations Command"',
            DESCRIPTION: '"Autonomous operational control and intelligence workbench"',
            ORGANIZATION_ID: "1",
            DATASET_ID: "1",
            H3_ORIGIN: '"8828308281fffff"',
            COORDINATES: JSON.stringify({ lat: 34.0522, lng: -118.2437 }),
            POLL_INTERVAL: "5000",
            SLO_THRESHOLD: "99.9",
        };

        // 3. Resolve any remaining {{SLOT_NAME}} tokens with safe defaults
        const REMAINING_SLOT_REGEX = /\{\{([A-Z0-9_]+)\}\}/g;
        result = result.replace(REMAINING_SLOT_REGEX, (_match, slotKey) => {
            const fallback = DEFAULT_SLOT_RESOLVERS[slotKey];
            if (fallback) {
                return typeof fallback === 'function' ? fallback() : fallback;
            }
            logger.warn(`Unresolved blueprint slot: ${slotKey} — defaulting to safe empty string`);
            return '""';
        });

        return result;
    }

    async getBlockRegistry(): Promise<any> {
        const registryPath = path.join(process.cwd(), 'server/domain/apps/core/block-registry.json');
        const content = await fs.readFile(registryPath, 'utf8');
        return JSON.parse(content);
    }

    async listBlueprints(): Promise<any[]> {
        const BLUEPRINT_CATALOG: Record<string, {
            name: string;
            category: string;
            persona: string;
            description: string;
            capabilities: string[];
            icon: string;
            governanceRisk: "low" | "medium" | "high";
            keywords: string[];
        }> = {
            // 1. Operations & Field
            "rescue-dispatch": {
                name: "Rescue Dispatch Command",
                category: "Operations & Field",
                persona: "Incident Commander",
                description: "Emergency & field dispatch console with Uber H3 hexagonal spatial analytics, live telemetry streams, and squad tracking.",
                capabilities: ["Spatial", "API", "Charts", "Auth"],
                icon: "ShieldAlert",
                governanceRisk: "high",
                keywords: ["dispatch", "rescue", "spatial-h3", "emergency", "maps"]
            },
            "ops-workbench": {
                name: "Operations Incident Workbench",
                category: "Operations & Field",
                persona: "Operations Manager",
                description: "Incident triage, SLA tracking, runbook execution, and root cause diagnosis console.",
                capabilities: ["Forms", "API", "Charts", "AI"],
                icon: "Zap",
                governanceRisk: "medium",
                keywords: ["operations", "incident", "triage", "sla", "runbook"]
            },
            "location-search": {
                name: "Location & Proximity Search",
                category: "Operations & Field",
                persona: "Field Coordinator",
                description: "Proximity-based asset lookup, radius clustering, and spatial boundary intersection queries.",
                capabilities: ["Spatial", "Search", "API"],
                icon: "Search",
                governanceRisk: "low",
                keywords: ["geo", "proximity", "places", "spatial"]
            },
            "industrial-dashboard": {
                name: "Industrial IoT & SCADA Monitor",
                category: "Operations & Field",
                persona: "Industrial Engineer",
                description: "Hardware telemetry ingestion, factory sensor clustering, and real-time anomaly detection dashboard.",
                capabilities: ["Charts", "Database", "API"],
                icon: "BarChart2",
                governanceRisk: "medium",
                keywords: ["iot", "scada", "telemetry", "industrial", "hardware"]
            },

            // 2. SDLC & Engineering
            "sdlc-workbench": {
                name: "Autonomous SDLC Workbench",
                category: "SDLC & Engineering",
                persona: "Engineering Lead",
                description: "End-to-end software delivery workbench: requirements synthesis, pull request critique, and CI/CD deployment gates.",
                capabilities: ["Code", "API", "AI", "Auth"],
                icon: "Code",
                governanceRisk: "high",
                keywords: ["sdlc", "cicd", "repository", "git", "code-review"]
            },
            "codegen-pipeline-workbench": {
                name: "AST Codegen Pipeline Studio",
                category: "SDLC & Engineering",
                persona: "Core Systems Engineer",
                description: "Abstract Syntax Tree codegen compiler, scaffold generator, and formal layout theorem prover.",
                capabilities: ["Code", "AI", "Forms"],
                icon: "FileCode",
                governanceRisk: "medium",
                keywords: ["codegen", "ast", "scaffold", "compiler"]
            },
            "devops-workbench": {
                name: "DevOps & Container Console",
                category: "SDLC & Engineering",
                persona: "DevOps Engineer",
                description: "Docker container lifecycle management, dynamic port allocation, and cluster health monitoring.",
                capabilities: ["Database", "API", "Shield"],
                icon: "Hammer",
                governanceRisk: "high",
                keywords: ["devops", "infrastructure", "kubernetes", "docker"]
            },
            "qa-workbench": {
                name: "QA & Autonomous Test Workbench",
                category: "SDLC & Engineering",
                persona: "QA Architect",
                description: "Playwright E2E contract test suites, Vitest runner, and flaky test auto-healing engine.",
                capabilities: ["Code", "Charts", "Forms"],
                icon: "CheckCircle2",
                governanceRisk: "medium",
                keywords: ["qa", "testing", "playwright", "vitest", "flaky"]
            },
            "agent-training-workbench": {
                name: "Agent Eval & Fine-Tuning Studio",
                category: "SDLC & Engineering",
                persona: "AI Engineer",
                description: "Agent evaluation suites, fine-tuning dataset synthesis, and prompt benchmark comparison cockpit.",
                capabilities: ["AI", "Database", "Charts"],
                icon: "Bot",
                governanceRisk: "medium",
                keywords: ["training", "eval", "fine-tune", "benchmarks"]
            },

            // 3. Governance & Compliance
            "compliance-sentinel": {
                name: "Compliance Sentinel & Audit Portal",
                category: "Governance & Compliance",
                persona: "Compliance Auditor",
                description: "SOC2 / W3C distributed tracing, cryptographic SHA-256 event chains, and policy invariant simulation.",
                capabilities: ["Shield", "Database", "Forms", "Auth"],
                icon: "Shield",
                governanceRisk: "high",
                keywords: ["compliance", "soc2", "audit", "governance", "w3c"]
            },
            "mission-supervisor": {
                name: "Mission Supervisor Cockpit",
                category: "Governance & Compliance",
                persona: "Mission Controller",
                description: "Multi-strategy mission blackboard inspector, human approval gate queue, and dynamic replanning monitor.",
                capabilities: ["AI", "Charts", "API", "Auth"],
                icon: "Bot",
                governanceRisk: "high",
                keywords: ["mission", "supervisor", "orchestration", "blackboard"]
            },
            "it-ticketing-portal": {
                name: "IT Service Desk & Access Portal",
                category: "Governance & Compliance",
                persona: "IT Administrator",
                description: "Service request intake, hardware provisioning approvals, and zero-trust role assignment workflows.",
                capabilities: ["Forms", "Auth", "Database"],
                icon: "FileCode",
                governanceRisk: "medium",
                keywords: ["helpdesk", "servicedesk", "tickets", "access-control"]
            },

            // 4. Business & Intelligence
            "analytics-dashboard": {
                name: "Executive Analytics Dashboard",
                category: "Business & Intelligence",
                persona: "Data Analyst",
                description: "Real-time KPI monitoring, timeseries trends, custom SQL aggregation, and business intelligence charts.",
                capabilities: ["Charts", "Database", "API"],
                icon: "BarChart3",
                governanceRisk: "low",
                keywords: ["analytics", "dashboard", "kpi", "metrics"]
            },
            "ai-workforce-dashboard": {
                name: "AI Workforce & Swarm Capacity",
                category: "Business & Intelligence",
                persona: "Operations VP",
                description: "Autonomous worker fleet monitoring, task bidding market clearing, and token economy cost control.",
                capabilities: ["AI", "Charts", "Database"],
                icon: "BarChart2",
                governanceRisk: "medium",
                keywords: ["workforce", "agents", "fleet", "economy"]
            },
            "budgetmaster-workbench": {
                name: "BudgetMaster Financial Hub",
                category: "Business & Intelligence",
                persona: "Financial Controller",
                description: "Burn rate tracking, department budget allocations, expense variance analysis, and invoice reconciliation.",
                capabilities: ["Charts", "Forms", "Database"],
                icon: "BarChart3",
                governanceRisk: "medium",
                keywords: ["budget", "finance", "burn-rate", "accounting"]
            },
            "budgetmaster-advisor": {
                name: "BudgetMaster Advisory Copilot",
                category: "Business & Intelligence",
                persona: "Financial Analyst",
                description: "AI-assisted capital allocation, scenario stress-testing, and investment risk advisory.",
                capabilities: ["AI", "Charts", "API"],
                icon: "Bot",
                governanceRisk: "low",
                keywords: ["advisor", "portfolio", "forecast", "finance"]
            },
            "sales-opportunity-workbench": {
                name: "Sales Opportunity & Deal Desk",
                category: "Business & Intelligence",
                persona: "Sales Director",
                description: "B2B sales pipeline management, AI deal qualification, and quotation approval matrix.",
                capabilities: ["Forms", "Charts", "Database"],
                icon: "BarChart3",
                governanceRisk: "low",
                keywords: ["sales", "pipeline", "deals", "crm"]
            },
            "stakeholder-workbench": {
                name: "Stakeholder Briefing Suite",
                category: "Business & Intelligence",
                persona: "Executive Stakeholder",
                description: "Executive project briefs, strategic milestone reviews, and cross-department KPI rollups.",
                capabilities: ["Charts", "Forms", "Auth"],
                icon: "Layout",
                governanceRisk: "low",
                keywords: ["stakeholder", "briefing", "kpi", "executive"]
            },
            "pm-workbench": {
                name: "Product Manager Roadmap Hub",
                category: "Business & Intelligence",
                persona: "Product Manager",
                description: "Feature prioritization matrix, customer voice clustering, and quarterly roadmap planner.",
                capabilities: ["Forms", "Charts", "AI"],
                icon: "Layout",
                governanceRisk: "low",
                keywords: ["product-manager", "roadmap", "backlog", "epics"]
            },
            "product-launch-workbench": {
                name: "Product Launch Command Center",
                category: "Business & Intelligence",
                persona: "Product Marketer",
                description: "Go-to-market execution checklists, launch day telemetry, and cross-functional task coordination.",
                capabilities: ["Forms", "Charts", "API"],
                icon: "Zap",
                governanceRisk: "low",
                keywords: ["launch", "gtm", "checklist", "release"]
            },
            "scrum-master-workbench": {
                name: "Agile Scrum Master Workbench",
                category: "Business & Intelligence",
                persona: "Scrum Master",
                description: "Sprint burndown tracking, team velocity forecasting, and automated standup summaries.",
                capabilities: ["Charts", "Forms", "AI"],
                icon: "Layout",
                governanceRisk: "low",
                keywords: ["scrum", "sprint", "velocity", "agile"]
            },
            "support-agent-dashboard": {
                name: "Customer Support Orchestrator",
                category: "Business & Intelligence",
                persona: "Support Lead",
                description: "Omnichannel customer ticket routing, CSAT telemetry, and AI suggested solution synthesis.",
                capabilities: ["Forms", "AI", "Database"],
                icon: "Bot",
                governanceRisk: "low",
                keywords: ["support", "tickets", "csat", "zendesk"]
            },
            "research-workbench": {
                name: "Scientific Research & ArXiv Hub",
                category: "Business & Intelligence",
                persona: "Research Scientist",
                description: "Academic literature retrieval, multi-document synthesis, and citation knowledge graph exploration.",
                capabilities: ["Search", "AI", "Database"],
                icon: "Search",
                governanceRisk: "low",
                keywords: ["research", "literature", "arxiv", "papers"]
            },

            // 5. Foundational & Microservices
            "chat-assistant": {
                name: "Grounded Chat Assistant",
                category: "Foundational & Microservices",
                persona: "Knowledge Worker",
                description: "Conversational copilot backed by organizational knowledge grounding, RAG, and execution affordances.",
                capabilities: ["AI", "API", "Auth"],
                icon: "Bot",
                governanceRisk: "low",
                keywords: ["chat", "assistant", "support", "rag"]
            },
            "chat-assistant-v2": {
                name: "Socratic Crew War Room",
                category: "Foundational & Microservices",
                persona: "Collaboration Lead",
                description: "Multi-agent deliberation room with Socratic turn-taking, consensus voting, and formal debate critique.",
                capabilities: ["AI", "API", "Auth"],
                icon: "Bot",
                governanceRisk: "medium",
                keywords: ["crew", "multi-agent", "governed-chat", "socratic"]
            },
            "crud-app": {
                name: "Relational Data Workbench",
                category: "Foundational & Microservices",
                persona: "Data Operator",
                description: "Relational database record viewer, filterable data tables, inline editing, and CSV/JSON export.",
                capabilities: ["Database", "Forms", "API", "Auth"],
                icon: "Database",
                governanceRisk: "low",
                keywords: ["crud", "crm", "database", "tables"]
            },
            "api": {
                name: "Headless API Gateway Microservice",
                category: "Foundational & Microservices",
                persona: "Backend Developer",
                description: "REST & GraphQL API gateway, webhook ingestion pipeline, and automated OpenAPI documentation.",
                capabilities: ["API", "Auth"],
                icon: "Globe",
                governanceRisk: "medium",
                keywords: ["api", "backend", "microservice", "rest"]
            },
            "spa": {
                name: "Responsive Single Page App",
                category: "Foundational & Microservices",
                persona: "Frontend Developer",
                description: "Client-side React SPA wired to Oddjob design system tokens, routing, and authentication.",
                capabilities: ["Layout", "Auth"],
                icon: "Layout",
                governanceRisk: "low",
                keywords: ["spa", "web app", "portal", "react"]
            },
            "pwa": {
                name: "Offline-First Progressive Web App",
                category: "Foundational & Microservices",
                persona: "Mobile Developer",
                description: "Progressive web app with ServiceWorker offline persistence, install prompts, and mobile viewport tuning.",
                capabilities: ["Smartphone", "Layout"],
                icon: "Smartphone",
                governanceRisk: "low",
                keywords: ["pwa", "mobile", "offline", "installable"]
            },
            "react-native": {
                name: "Cross-Platform Mobile Bundle",
                category: "Foundational & Microservices",
                persona: "Mobile Engineer",
                description: "React Native application bundle targeting iOS and Android with unified API connectors.",
                capabilities: ["Smartphone", "API"],
                icon: "Smartphone",
                governanceRisk: "medium",
                keywords: ["mobile", "react-native", "ios-android"]
            },
            "wayfare": {
                name: "Wayfare Logistics & Travel",
                category: "Foundational & Microservices",
                persona: "Travel Coordinator",
                description: "Multi-leg itinerary planning, lodging coordination, and expense receipt reconciliation.",
                capabilities: ["Forms", "API", "Charts"],
                icon: "Globe",
                governanceRisk: "low",
                keywords: ["travel", "itinerary", "booking", "logistics"]
            },
            "go-backend": {
                name: "Go High-Throughput Service",
                category: "Foundational & Microservices",
                persona: "Systems Engineer",
                description: "Ultra-low-latency Go (Gin/Fiber) service container optimized for high-concurrency event ingestion.",
                capabilities: ["Code", "API"],
                icon: "Code",
                governanceRisk: "medium",
                keywords: ["go", "gin", "golang", "microservice"]
            },
            "python-backend": {
                name: "Python FastAPI Analytics Service",
                category: "Foundational & Microservices",
                persona: "Python / Data Engineer",
                description: "Asynchronous Python FastAPI service container with PyTorch and Pandas analytics dependencies.",
                capabilities: ["Code", "API", "AI"],
                icon: "Code",
                governanceRisk: "medium",
                keywords: ["python", "fastapi", "django", "analytics"]
            },
            "java-backend": {
                name: "Java Spring Enterprise Service",
                category: "Foundational & Microservices",
                persona: "Enterprise Architect",
                description: "Enterprise Java Spring Boot microservice with JPA repository integration and Kafka consumers.",
                capabilities: ["Code", "Database", "API"],
                icon: "Code",
                governanceRisk: "medium",
                keywords: ["java", "spring", "maven", "enterprise"]
            },
        };

        return Object.entries(BLUEPRINT_CATALOG).map(([slug, meta]) => ({
            slug,
            ...meta,
            maturity: BLUEPRINT_MATURITY[slug] ?? "experimental",
        }));
    }
}

export const forgeBlueprintService = new ForgeBlueprintService();
