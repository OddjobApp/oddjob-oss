/**
 * Central Blueprint Registry
 * 
 * Provides rich metadata for app blueprints that exist on disk.
 * This ensures the frontend doesn't need to hardcode descriptions, icons, or categories.
 */

export interface BlueprintMetadata {
    slug: string;
    name: string;
    description: string;
    capabilities: string[];
    icon: string; // Icon name matching lucide-react
    category: string;
    governanceDependencies?: Array<{
        pack: string;
        version: string;
        required: boolean;
        requiredControls: string[];
        requiredContext: string[];
        unresolvedBehavior: "BLOCK";
    }>;
}

const REGISTRY: Record<string, BlueprintMetadata> = {
    'synthetic-finance-communications': {
        slug: 'synthetic-finance-communications',
        name: 'Synthetic Finance Communications',
        description: 'Demonstration workflow for role-separated drafting, compliance review, hash-bound approval, governed publication, and evidence capture. Not regulatory coverage.',
        capabilities: ['Drafting', 'Compliance Review', 'Hash-Bound Approval', 'Governed Publication', 'Audit Evidence'],
        icon: 'Landmark',
        category: 'Governance Demo',
        governanceDependencies: [{
            pack: 'synthetic-finance-governance',
            version: '>=1.0.0 <2.0.0',
            required: true,
            requiredControls: ['FIN-DEMO-*'],
            requiredContext: ['customerClassification', 'contentHash', 'approvalContentHash', 'archiveTarget'],
            unresolvedBehavior: 'BLOCK',
        }],
    },
    'analytics-dashboard': {
        slug: 'analytics-dashboard',
        name: 'Analytics Dashboard',
        description: 'Real-time metrics and trend visualization with configurable time ranges, StatCard KPIs, and multi-chart comparisons. Fetches data from Oddjob platform datasets.',
        capabilities: ['Live Metrics', 'Multi-Chart', 'Date Range Filter', 'Platform Datasets'],
        icon: 'BarChart2',
        category: 'Analytics'
    },
    'industrial-dashboard': {
        slug: 'industrial-dashboard',
        name: 'Industrial Dashboard (Mach 4)',
        // Renamed from "Deterministic Assembly" / "Mach 4 Evolution" — an
        // unproven behavioural claim and a brand label. These name the blocks
        // the template actually composes.
        description: 'Industrial monitoring dashboard assembled from packaged hero, metric grid, timeline, and mission control table blocks on a glassmorphism surface.',
        capabilities: ['Assembly Slots', 'Mission Control Table', 'Real-time Telemetry', 'Glassmorphism'],
        icon: 'Zap',
        category: 'Analytics'
    },
    'chat-assistant': {
        slug: 'chat-assistant',
        name: 'Chat Assistant',
        description: 'Streaming conversational agent with typing indicators, conversation history, suggested prompts, and platform-backed message persistence.',
        capabilities: ['Streaming UI', 'Conversation History', 'Suggested Prompts', 'Platform API'],
        icon: 'Bot',
        category: 'Communication'
    },
    'chat-assistant-v2': {
        slug: 'chat-assistant-v2',
        name: 'AI Assistant (Mach 4)',
        // Renamed from "Mach 4 Assembly" / "High-Fidelity Blocks": those were
        // brand and quality labels with nothing in the code behind them. These
        // name what the template actually does — fill assembly slots and render
        // packaged platform chat blocks — so the claims are checkable.
        description: 'Conversational interface assembled from packaged platform chat blocks, with a glassmorphism shell and streaming-ready responses.',
        capabilities: ['Assembly Slots', 'Packaged Chat Blocks', 'Glassmorphism', 'Streaming-Ready'],
        icon: 'MessageSquare',
        category: 'Communication'
    },
    'crud-app': {
        slug: 'crud-app',
        name: 'CRUD App',
        description: 'Full create-read-update-delete application with a sortable DataTable, modal forms, delete confirmation, and a platform dataset backend.',
        capabilities: ['DataTable', 'Modal Forms', 'Search & Sort', 'Platform Datasets'],
        icon: 'Database',
        category: 'Productivity'
    },
    'api': {
        slug: 'api',
        name: 'API',
        description: 'Headless REST API with a built-in Explorer UI. All routes proxy through the Oddjob platform back-channel. Ideal for integrations, webhooks, and data exchange.',
        capabilities: ['REST Routes', 'API Explorer', 'Platform Proxy', 'Webhook Ready'],
        icon: 'Globe',
        category: 'Integration'
    },
    'spa': {
        slug: 'spa',
        name: 'Single Page App',
        description: 'Fluid multi-page shell with sidebar navigation, animated page transitions, and a clean layout ready for any domain-specific content.',
        capabilities: ['Sidebar Nav', 'Page Transitions', 'Responsive Layout', 'Platform API'],
        icon: 'Layout',
        category: 'General'
    },
    'pwa': {
        slug: 'pwa',
        name: 'Progressive Web App',
        description: 'Mobile-first web app with offline support, install-to-home-screen prompt, and a web manifest. Works without a connection once cached.',
        capabilities: ['Offline Mode', 'Installable', 'Web Manifest', 'Mobile First'],
        icon: 'Smartphone',
        category: 'Mobile'
    },
    'rescue-dispatch': {
        slug: 'rescue-dispatch',
        name: 'Rescue Dispatcher',
        // "Geo Routing" -> "Tactical Routing": routing is real, but nothing in
        // the code is named "geo". "address autocomplete" dropped from the
        // description for the same reason — the resolver does address search.
        description: 'Mission-critical coordinator for emergency response with an interactive Mapbox map, address search, dataset-backed markers, and real-time alerts.',
        capabilities: ['Interactive Map', 'Location Search', 'Real-time Alerts', 'Tactical Routing'],
        icon: 'Zap',
        category: 'Mission Critical'
    },
    'mission-supervisor': {
        slug: 'mission-supervisor',
        name: 'Mission Supervisor',
        description: 'Industrial coordinator for autonomous missions with real-time run status, live log streaming, pipeline trigger controls, and HIL approval integration.',
        capabilities: ['Mission Runs', 'Live Logs', 'Pipeline Triggers', 'HIL Ready'],
        icon: 'ShieldAlert',
        category: 'Mission Critical'
    },
    'wayfare': {
        slug: 'wayfare',
        name: 'Wayfare Long-Haul Planner',
        description: 'Long-haul truck and passenger/commercial EV planning in CREW with measured consumption, reserve-aware fuel or battery forecasts, verified charging assumptions and Mapbox road legs.',
        capabilities: ['Truck Profiles', 'Fuel Usage', 'EV Energy and Charging Plans', 'Range Forecasts', 'Mapbox Road Legs', 'GPX Waypoints', 'CREW Context'],
        icon: 'Compass',
        category: 'Travel'
    },

    // ── Workbenches, portals, and backend starters ───────────────────────────
    //
    // These blueprints all had source under `server/blueprints/apps` but no
    // registry entry, which made them invisible to the App Marketplace, to the
    // capability catalog, and therefore to the Copilot — however complete they
    // were. Each entry below was written FROM the blueprint's own source (its
    // routes, components, and dependencies), not from intent, so the declared
    // capabilities are checkable by the blueprint drift detector rather than
    // aspirational.

    'agent-training-workbench': {
        slug: 'agent-training-workbench',
        name: 'Agent Training Workbench',
        description: 'Closed-loop workbench for improving agents: run scenarios in a simulation arena, analyse failures, curate a training corpus, and gate promotion on eval results.',
        capabilities: ['Simulation Arena', 'Failure Analysis', 'Training Corpus', 'Promotion Gate', 'Eval Dashboard'],
        icon: 'GraduationCap',
        category: 'AI Operations'
    },
    'ai-workforce-dashboard': {
        slug: 'ai-workforce-dashboard',
        name: 'Agent Fleet Command',
        description: 'Live command surface for an agent fleet — workload polling, an attention queue for items needing a human, cost optimization, and autonomy guardrails.',
        capabilities: ['Fleet Workload', 'Attention Queue', 'Cost Optimizer', 'Autonomy Policy'],
        icon: 'Bot',
        category: 'AI Operations'
    },
    'budgetmaster-advisor': {
        slug: 'budgetmaster-advisor',
        name: 'BudgetMaster Advisor',
        description: 'Single-surface budget advisor with an embedded agent chat, built on the shared workbench shell.',
        capabilities: ['Budget Advisor', 'Agent Chat', 'Workbench Shell'],
        icon: 'PiggyBank',
        category: 'Finance'
    },
    'budgetmaster-workbench': {
        slug: 'budgetmaster-workbench',
        name: 'BudgetMaster Workbench',
        description: 'Full personal-finance workbench: accounts, a transaction ledger, spend forecasting, and threshold alerts, charted with Recharts.',
        capabilities: ['Accounts', 'Ledger', 'Forecast', 'Alerts', 'Agent Chat'],
        icon: 'Wallet',
        category: 'Finance'
    },
    'codegen-pipeline-workbench': {
        slug: 'codegen-pipeline-workbench',
        name: 'Codegen Pipeline Workbench',
        description: 'Drives and observes code-generation cycles — trigger a cycle run, follow step banners as waves complete, and review pipeline metrics.',
        capabilities: ['Cycle Run', 'Pipeline', 'Metrics'],
        icon: 'GitBranch',
        category: 'Engineering'
    },
    'devops-workbench': {
        slug: 'devops-workbench',
        name: 'DevOps Workbench',
        description: 'Industrial DevOps surface with an incident triager widget and an embedded agent chat over the platform API.',
        capabilities: ['Incident Triage', 'Agent Chat'],
        icon: 'Wrench',
        category: 'Operations'
    },
    'go-backend': {
        slug: 'go-backend',
        name: 'Go / Gin Backend',
        description: 'Minimal Go service on the Gin router exposing a health endpoint — a starting point for Go-based backend work.',
        capabilities: ['Gin Runtime', 'Health Status'],
        icon: 'Server',
        category: 'Backend'
    },
    'it-ticketing-portal': {
        slug: 'it-ticketing-portal',
        name: 'IT Ticketing Portal',
        description: 'Internal IT support portal — submit tickets, browse the ticket list, and route incoming work through agent triage.',
        capabilities: ['Ticket Submit', 'Agent Triage', 'Error Report'],
        icon: 'Ticket',
        category: 'IT Service'
    },
    'java-backend': {
        slug: 'java-backend',
        name: 'Java / Spring Boot Backend',
        description: 'Minimal Spring Boot service exposing a health controller — a starting point for JVM-based backend work.',
        capabilities: ['Spring Boot Runtime', 'Health Status'],
        icon: 'Server',
        category: 'Backend'
    },
    'location-search': {
        slug: 'location-search',
        name: 'Location Search',
        description: 'Mapbox-backed location search with an interactive map component.',
        capabilities: ['Location Search', 'Mapbox Map'],
        icon: 'MapPin',
        category: 'Geospatial'
    },
    'ops-workbench': {
        slug: 'ops-workbench',
        name: 'Ops Workbench',
        description: 'Operational monitoring surface over platform records and missions, with incident signals and an embedded agent chat.',
        capabilities: ['Mission Records', 'Incident Monitoring', 'Agent Chat'],
        icon: 'Activity',
        category: 'Operations'
    },
    'incident-response-workbench': {
        slug: 'incident-response-workbench', name: 'Incident Response',
        description: 'Room-scoped incident register, versioned recovery timeline and CREW input. Provider remediation requires connected tools and approvals.',
        capabilities: ['Durable incident cases', 'Evidence-referenced transitions', 'CREW context and input'],
        icon: 'AlertTriangle', category: 'Operations'
    },
    'pm-workbench': {
        slug: 'pm-workbench',
        name: 'Product Manager Workbench',
        description: 'PRD authoring and backlog grooming with Confluence sourcing, knowledge context, an approval timeline, and a sign-off gate.',
        capabilities: ['PRD Editor', 'Backlog List', 'Approval Timeline', 'Confluence Source', 'Signoff Panel'],
        icon: 'ClipboardList',
        category: 'Product'
    },
    'product-launch-workbench': {
        slug: 'product-launch-workbench',
        name: 'Product Launch Workbench',
        description: 'Runs a launch end to end — market research, a content studio, A/B test analysis, feedback insights, and a launch command center.',
        capabilities: ['Launch Command Center', 'Market Research', 'Content Studio', 'Feedback Insights', 'Test Analyzer'],
        icon: 'Rocket',
        category: 'Product'
    },
    'python-backend': {
        slug: 'python-backend',
        name: 'Python / FastAPI Backend',
        description: 'Minimal FastAPI service run under Uvicorn exposing a health check — a starting point for Python-based backend work.',
        capabilities: ['FastAPI Runtime', 'Health Status'],
        icon: 'Server',
        category: 'Backend'
    },
    'qa-workbench': {
        slug: 'qa-workbench',
        name: 'QA Workbench',
        description: 'Test-and-investigate surface: drive Playwright runs and browser autopilot, capture console output, surface similar defects, and push status to Jira.',
        capabilities: ['Playwright Runner', 'Browser Autopilot', 'Console Capture', 'Self-Healing Engine', 'Similar Defects', 'Jira Status'],
        icon: 'TestTube',
        category: 'Quality'
    },
    'react-native': {
        slug: 'react-native',
        name: 'Mobile App (Expo)',
        description: 'Expo-managed React Native starter styled with NativeWind — the scaffold for mobile forge targets.',
        capabilities: ['Expo', 'NativeWind', 'Mobile App'],
        icon: 'Smartphone',
        category: 'Mobile'
    },
    'research-workbench': {
        slug: 'research-workbench',
        name: 'Research Workbench',
        description: 'Classifies a research request, picks a strategy, executes and re-runs it with progress tracking, then feeds a decision panel and backlog provisioner.',
        capabilities: ['Research Classify', 'Research Strategy', 'Decision Panel', 'Backlog Provisioner'],
        icon: 'Microscope',
        category: 'Research'
    },
    'sales-opportunity-workbench': {
        slug: 'sales-opportunity-workbench',
        name: 'Sales Opportunity Workbench',
        description: 'Pipeline surface built around deal cards, engagement timelines, and a decay bar for going-cold opportunities, with a human-in-the-loop gate on actions.',
        capabilities: ['Deal Card', 'Engagement Timeline', 'Decay Bar', 'HIL Gate', 'Cycle Run'],
        icon: 'TrendingUp',
        category: 'Sales'
    },
    'scrum-master-workbench': {
        slug: 'scrum-master-workbench',
        name: 'Scrum Master Workbench',
        description: 'Sprint operations with a drag-and-drop board, burndown prediction, blocker forecasting, dependency radar, capacity view, and retro capture.',
        capabilities: ['Sprint Board', 'Burndown Predictor', 'Blocker Prediction', 'Dependency Radar', 'Capacity Panel', 'Retro Panel'],
        icon: 'Users',
        category: 'Agile'
    },
    'sdlc-workbench': {
        slug: 'sdlc-workbench',
        name: 'SDLC Workbench',
        description: 'Delivery cockpit spanning the software lifecycle — activity feed, diff review, bulk approvals, human-in-the-loop forms, and live logs.',
        capabilities: ['Activity Feed', 'Diff Review', 'Bulk Approval', 'HIL Form', 'Live Logs'],
        icon: 'GitPullRequest',
        category: 'Engineering'
    },
    'stakeholder-workbench': {
        slug: 'stakeholder-workbench',
        name: 'Stakeholder Workbench',
        description: 'Read-mostly stakeholder view of agent workload and delivery signals, designed to run embedded in the platform workbench shell.',
        capabilities: ['Agent Workload', 'Embedded Workbench'],
        icon: 'Landmark',
        category: 'Reporting'
    },
    'support-agent-dashboard': {
        slug: 'support-agent-dashboard',
        name: 'Support Agent Dashboard',
        description: 'Front line support surface — work the ticket queue, handle escalations, and maintain the knowledge base from a built-in editor.',
        capabilities: ['Ticket Queue', 'Escalations', 'Knowledge Editor'],
        icon: 'Headphones',
        category: 'Support'
    }
};

import { db } from "../../database_service.js";
import { apps } from "../../../shared/schema/apps.js";
import { eq, or, isNull } from "drizzle-orm";

export const blueprintRegistryService = {
    /**
     * Get metadata for all known blueprints.
     * Combines static system blueprints with dynamic org-level apps.
     */
    async listAll(orgId?: number): Promise<BlueprintMetadata[]> {
        const systemBlueprints = Object.values(REGISTRY);
        
        if (!orgId) return systemBlueprints;

        // Fetch dynamic blueprints from the database
        const orgApps = await db.select().from(apps).where(
            eq(apps.developerOrgId, orgId)
        );

        const dynamicBlueprints: BlueprintMetadata[] = orgApps.map(app => ({
            slug: app.slug,
            name: `${app.name} (Clone)`,
            description: app.description || `Custom template based on your forged app: ${app.name}`,
            capabilities: ['Dynamic Clone', 'Org Specific'],
            icon: app.icon || 'Box',
            category: 'Org Templates'
        }));

        // Merge and deduplicate by slug (System blueprints win)
        const combined = [...systemBlueprints];
        for (const dbp of dynamicBlueprints) {
            if (!combined.find(s => s.slug === dbp.slug)) {
                combined.push(dbp);
            }
        }

        return combined;
    },

    /**
     * Get specific metadata for a blueprint slug.
     */
    async get(slug: string, orgId?: number): Promise<BlueprintMetadata | null> {
        // 1. Check static registry
        if (REGISTRY[slug]) return REGISTRY[slug];

        // 2. Check dynamic org registry
        if (orgId) {
            const [app] = await db.select().from(apps).where(
                or(
                    eq(apps.slug, slug)
                )
            );
            if (app && (app.developerOrgId === orgId || app.isPublic)) {
                return {
                    slug: app.slug,
                    name: `${app.name} (Clone)`,
                    description: app.description || "",
                    capabilities: ['Dynamic Clone'],
                    icon: app.icon || 'Box',
                    category: 'Org Templates'
                };
            }
        }

        return null;
    },

    /**
     * Enrich a list of slugs with metadata.
     */
    async enrich(slugs: string[]): Promise<BlueprintMetadata[]> {
        return slugs.map(slug => REGISTRY[slug] || {
            slug,
            name: slug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' '),
            description: `Industrial-grade blueprint for ${slug.replace(/-/g, ' ')} modules.`,
            capabilities: ['General Capability'],
            icon: 'Hammer',
            category: 'Miscellaneous'
        });
    }
};


