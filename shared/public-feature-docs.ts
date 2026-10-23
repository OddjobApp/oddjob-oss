/** Explicit public capability guides. Never accepts organization documents or caller paths. */
export const PUBLIC_FEATURE_DOCS = [
  {
    "slug": "crew",
    "title": "CREW rooms",
    "featureId": "crew",
    "guide": "server/knowledge/public-features/crew.md",
    "section": null
  },
  {
    "slug": "missions",
    "title": "Durable missions",
    "featureId": "mission",
    "guide": "server/knowledge/public-features/missions.md",
    "section": null
  },
  {
    "slug": "approvals",
    "title": "Approvals and execution evidence",
    "featureId": "mission",
    "guide": "server/knowledge/public-features/approvals.md",
    "section": null
  },
  {
    "slug": "pipelines",
    "title": "Pipelines",
    "featureId": "pipeline",
    "guide": "server/knowledge/public-features/pipelines.md",
    "section": null
  },
  {
    "slug": "schedules",
    "title": "Automations",
    "featureId": "schedules",
    "guide": "server/knowledge/public-features/schedules.md",
    "section": null
  },
  {
    "slug": "cycles",
    "title": "Business cycles",
    "featureId": "cycles",
    "guide": "server/knowledge/public-features/cycles.md",
    "section": null
  },
  {
    "slug": "app-forge",
    "title": "App Forge",
    "featureId": "apps",
    "guide": "server/knowledge/public-features/app-forge.md",
    "section": null
  },
  {
    "slug": "published-forms",
    "title": "Published agents and forms",
    "featureId": "forms",
    "guide": "server/knowledge/public-features/published-forms.md",
    "section": null
  },
  {
    "slug": "knowledge",
    "title": "Organizational knowledge",
    "featureId": "knowledge",
    "guide": "server/knowledge/public-features/knowledge.md",
    "section": null
  },
  {
    "slug": "datasets",
    "title": "Structured datasets",
    "featureId": "datasets",
    "guide": "server/knowledge/public-features/datasets.md",
    "section": null
  },
  {
    "slug": "spatial",
    "title": "Spatial intelligence",
    "featureId": "signal-intelligence",
    "guide": "server/knowledge/public-features/spatial.md",
    "section": null
  },
  {
    "slug": "integrations",
    "title": "Connected services and MCP",
    "featureId": "integrations",
    "guide": "server/knowledge/public-features/integrations.md",
    "section": null
  },
  {
    "slug": "agentmail",
    "title": "Organization email with AgentMail",
    "featureId": "integrations",
    "guide": "server/knowledge/public-features/agentmail.md",
    "section": null
  },
  {
    "slug": "computer-use",
    "title": "Computer use and human takeover",
    "featureId": "computer-use",
    "guide": "server/knowledge/public-features/computer-use.md",
    "section": null
  },
  {
    "slug": "media",
    "title": "Scribe and Media Studio",
    "featureId": "media-studio",
    "guide": "server/knowledge/public-features/media.md",
    "section": null
  },
  {
    "slug": "android",
    "title": "Android app",
    "featureId": "crew",
    "guide": "server/knowledge/public-features/android.md",
    "section": null
  },
  {
    "slug": "desktop",
    "title": "Electron desktop app",
    "featureId": "crew",
    "guide": "server/knowledge/public-features/desktop.md",
    "section": null
  }
] as const;
export type PublicFeatureDocSlug = typeof PUBLIC_FEATURE_DOCS[number]['slug'];
