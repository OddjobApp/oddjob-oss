/** Explicit public platform guide catalog. Never accepts organization documents or caller paths. */
export const PUBLIC_FEATURE_DOCS = [
  {
    "slug": "crew",
    "title": "CREW rooms",
    "featureId": "crew",
    "guide": "docs/FEATURES.md",
    "section": "CREW Multi-Agent Rooms"
  },
  {
    "slug": "missions",
    "title": "Durable missions",
    "featureId": "mission",
    "guide": "docs/feature-documentation/core-features/05-missions-system.md",
    "section": null
  },
  {
    "slug": "approvals",
    "title": "Approvals and execution evidence",
    "featureId": "mission",
    "guide": "docs/specs/agent-governance.md",
    "section": null
  },
  {
    "slug": "pipelines",
    "title": "Pipelines",
    "featureId": "pipeline",
    "guide": "server/knowledge/features/pipelines.md",
    "section": null
  },
  {
    "slug": "schedules",
    "title": "Schedules",
    "featureId": "schedules",
    "guide": "server/knowledge/features/schedules.md",
    "section": null
  },
  {
    "slug": "cycles",
    "title": "Business cycles",
    "featureId": "cycles",
    "guide": "docs/feature-documentation/cycle-blueprint-builder.md",
    "section": null
  },
  {
    "slug": "app-forge",
    "title": "App Forge",
    "featureId": "apps",
    "guide": "docs/APP_FORGE_LIFECYCLE.md",
    "section": null
  },
  {
    "slug": "published-forms",
    "title": "Published agents and forms",
    "featureId": "forms",
    "guide": "server/knowledge/features/published-forms.md",
    "section": null
  },
  {
    "slug": "knowledge",
    "title": "Organizational knowledge",
    "featureId": "knowledge",
    "guide": "docs/feature-documentation/core-features/03-knowledge-system.md",
    "section": null
  },
  {
    "slug": "datasets",
    "title": "Structured datasets",
    "featureId": "datasets",
    "guide": "server/knowledge/features/datasets.md",
    "section": null
  },
  {
    "slug": "spatial",
    "title": "Spatial intelligence",
    "featureId": "signal-intelligence",
    "guide": "docs/FEATURES.md",
    "section": "Eulerian Hexagonal (Uber H3) Spatial Command Deck"
  },
  {
    "slug": "integrations",
    "title": "Connected services and MCP",
    "featureId": "integrations",
    "guide": "docs/developer-guides/ORG_OAUTH_APPS.md",
    "section": null
  },
  {
    "slug": "agentmail",
    "title": "Organization email with AgentMail",
    "featureId": "integrations",
    "guide": "docs/developer-guides/ORG_AGENTMAIL.md",
    "section": null
  },
  {
    "slug": "computer-use",
    "title": "Computer use and human takeover",
    "featureId": "computer-use",
    "guide": "server/knowledge/features/computer-use.md",
    "section": null
  },
  {
    "slug": "media",
    "title": "Scribe and Media Studio",
    "featureId": "media-studio",
    "guide": "docs/FEATURES.md",
    "section": "Governed AI Film Production & ComfyUI Media Studio"
  }
] as const;
export type PublicFeatureDocSlug = typeof PUBLIC_FEATURE_DOCS[number]['slug'];
