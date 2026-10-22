# Public capability sources

The public use-cases page groups documented capabilities into user-facing workflows. Every card links its source and states prerequisites. Documentation is checked against current mounted surfaces and route registration; presence in a roadmap is not treated as availability. No usage counts, reliability targets, or universal enablement claims are published.

- **CREW rooms**: `docs/FEATURES.md#crew-multi-agent-rooms`
- **Durable missions**: `docs/feature-documentation/core-features/05-missions-system.md`
- **Approvals and execution evidence**: `docs/specs/agent-governance.md`
- **Pipelines**: `docs/feature-documentation/core-features/02-pipelines-system.md`
- **Schedules**: `docs/feature-documentation/core-features/04-scheduling-system.md`
- **Business cycles**: `docs/feature-documentation/cycle-blueprint-builder.md`
- **App Forge**: `docs/guides/blueprint-maturity.md`
- **Published agents and forms**: `docs/developer-guides/PRODUCT_SCREENSHOTS.md`
- **Organizational knowledge**: `docs/feature-documentation/core-features/03-knowledge-system.md`
- **Structured datasets**: `docs/platform/05-component-and-tooling-guides/knowledge-garden-and-dataset-schemas.md`
- **Spatial intelligence**: `docs/FEATURES.md#eulerian-hexagonal-uber-h3-spatial-command-deck`
- **Connected services and MCP**: `docs/developer-guides/ORG_OAUTH_APPS.md`
- **Organization email with AgentMail**: `docs/developer-guides/ORG_AGENTMAIL.md`
- **Computer use and human takeover**: `server/knowledge/features/computer-use.md`
- **Scribe and Media Studio**: `docs/FEATURES.md#governed-ai-film-production--comfyui-media-studio`

Runtime checks: CREW and published forms were exercised in the public demonstration work; cycle-builder and Media Studio are mounted in server/routes.ts; computer use is mounted by the integrations route hub; schedules and datasets have mounted routing entries. App Forge production tenant execution limitations and blueprint maturity are explicitly retained. AgentMail uses the current organization-owned connection guide, not its retired shared-environment design.
