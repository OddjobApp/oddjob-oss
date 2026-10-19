/**
 * Goal Topic Archetypes & Playbook Configurations for CREW Rooms.
 *
 * Provides default goal playbooks, suggested roles, podComponent bindings,
 * and deliverables used in cold room initiation and DIVERSE directives.
 */

export interface TopicArchetype {
  id: string;
  label: string;
  icon: string;
  description: string;
  podComponent: string;
  defaultDirection: string;
  suggestedRoles: string[];
  suggestedDeliverables: string[];
}

/**
 * Offline fallback for the Goal Playbooks, used only when /api/crew/primers fails.
 * DIVERSE_TOPIC_DEFINITIONS on the server is the source of truth and replaces this list wholesale.
 */
export const DEFAULT_TOPIC_ARCHETYPES: TopicArchetype[] = [
  {
    id: 'presentation_deck_studio',
    label: 'Generate Deck & Documents',
    icon: '🎨',
    description: 'Assemble executive presentation decks, PDFs, Word docs, Excel sheets, and diagrams.',
    // DocumentPresentationViewer is a VIEWER (it takes a rendered `ast`) and lives
    // outside packaged/, so the registry glob never resolved it and this unit
    // mounted "Component isn't available to render." DocumentDeckPod collects the
    // intake; the generated deck still renders through the presentation_deck
    // artifact branch in AgentChatPanel, which is where the viewer belongs.
    podComponent: 'DocumentDeckPod',
    defaultDirection: 'Generate high-impact executive presentation deck and strategic document deliverables',
    suggestedRoles: ['Art Director', 'Information Architect', 'Data Storyteller', 'Brand Guardian'],
    suggestedDeliverables: [
      'Interactive 5-Theme Slide Deck AST',
      'Executive Summary & Briefing Deliverable',
      'Downloadable PDF & Word (.docx) Document',
      'Excel (.xlsx) Metrics & Mermaid Diagram',
    ],
  },
  {
    id: 'write_document',
    label: 'Author a Document (Scribe Studio)',
    icon: '📝',
    description: 'Draft SOWs, business cases, SOPs, proposals, contracts, or any longform document with AI-guided scaffolding.',
    podComponent: 'ScribeStudioPod',
    defaultDirection: 'Author a governed longform document with framework-guided structure and critic review',
    suggestedRoles: ['Scribe Lead', 'Commercial Counsel', 'Business Architect', 'Critic'],
    suggestedDeliverables: [
      'Statement of Work (SOW)',
      'Business Case & ROI Justification',
      'Standard Operating Procedure (SOP)',
      'Enterprise Proposal or RFP Response',
    ],
  },
  {
    id: 'film_production',
    label: 'Make a Film (Media Studio)',
    icon: '🎬',
    description: 'Storyboard scenes, render keyframes, shoot takes with Seedance and cut scene reels, with every video render approved first.',
    podComponent: 'FilmBriefPod',
    defaultDirection: 'Plan and shoot a short film in Media Studio, from story and storyboard to approved takes and scene reels',
    suggestedRoles: ['Director', 'Screenwriter', 'Cinematographer', 'Editor'],
    suggestedDeliverables: [
      'Screenplay in Scribe, linked to the production',
      'Storyboard with approved keyframes',
      'Shots with direction and dialogue',
      'Scene reels cut from approved takes',
    ],
  },
  {
    id: 'build_app',
    label: 'Build an App / Workflow',
    icon: '🏗️',
    description: 'Assemble an Operational Cycle, Scaffold, Pipeline, or Instant App surface.',
    podComponent: 'ScaffoldPackPod',
    defaultDirection: 'Assemble an automated Operational Cycle with scaffolds and UI pods',
    suggestedRoles: ['Copilot', 'Software Architect', 'Lead Developer'],
    suggestedDeliverables: [
      'Creation Studio Interactive Blueprint',
      'Node Express / FastAPI Backend Service',
      'HIL Governance Approval Flow',
      'Container Reconciliation & Deployment',
    ],
  },
  {
    id: 'research_topic',
    label: 'Research a Topic',
    icon: '🔬',
    description: 'Conduct multi-hop Knowledge Graph queries, web harvesting, and proposal synthesis.',
    podComponent: 'MissionBriefPod',
    defaultDirection: 'Deep multi-source research mission with knowledge base grounding',
    suggestedRoles: ['Research Lead', 'Researcher', 'Domain Lead'],
    suggestedDeliverables: [
      'Executive Research Brief & Findings',
      'Knowledge Graph Ingestion & Triples',
      'Evidence Matrix & Citations',
      'Automated Web Harvester Runbook',
    ],
  },
  {
    id: 'analytical_report',
    label: 'Request a Report',
    icon: '📊',
    description: 'Perform calculation node evaluations, timeseries analytics, and KPI dashboards.',
    podComponent: 'DocumentDeckPod',
    defaultDirection: 'Generate comprehensive analytical report with formula verification',
    suggestedRoles: ['Data Analyst', 'Operations Lead', 'Supervisor'],
    suggestedDeliverables: [
      'Calculation Node Metric Evaluation',
      'Timeseries Forecast & Trend Analysis',
      'Interactive Data Chart Surface',
      'Structured JSON / PDF Analytical Export',
    ],
  },
  {
    id: 'agent_roster',
    label: 'Configure Agent Fleet',
    icon: '🤖',
    description: 'Configure agent personas, model tiers, tool capabilities, and soul archetypes.',
    podComponent: 'AgenticHRPod',
    defaultDirection: 'Configure specialized agent fleet and assign domain capabilities',
    suggestedRoles: ['Copilot', 'Team Lead', 'Security Lead'],
    suggestedDeliverables: [
      'Configured Agent Personas & Capabilities',
      'Model Tier Allocations & Token Limits',
      'Soul Archetype & System Prompt Customization',
      'Team Roster Multi-Agent Topology',
    ],
  },
  {
    id: 'signal_intelligence',
    label: 'Signal Studio: Market Sensing & Exposure Triage',
    icon: '📡',
    description: 'Multi-source intelligence intake, Uber H3 spatial radar, 7 industry starter packs, CEL automated rules, and downstream mitigation playbooks.',
    podComponent: 'SignalStudioPod',
    defaultDirection: 'Ingest market signals, evaluate spatial exposure footprints across assets, and coordinate autonomous mitigation response playbooks',
    suggestedRoles: ['Intelligence Officer', 'Risk & Exposure Analyst', 'Operations Director', 'Special Situations Lead'],
    suggestedDeliverables: [
      'Signal Exposure Radar (Uber H3 Spatial Map)',
      'Configured Industry Feeds & Automated CEL Rules',
      'Operational Exposure Footprint & Blast Radius Analysis',
      'Autonomous Mitigation Response Playbook & HIL Gate',
    ],
  },
];
