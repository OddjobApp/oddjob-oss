# GitHub Copilot Instructions for Oddjob Workspace

## Repository Overview
Oddjob is a Governed Agentic AI Platform featuring:
- **Decision & Spatial Intelligence**: Signal feeds, event primitives, causal graph blast radius calculations, and cycle signal subscriptions (`/workspace/spatial`).
- **App Arsenal Marketplace**: Reusable 3-stage blueprint cycles (`incident-response-chain`, `competitive-intelligence-strategy`, `sre-operations-suite`).
- **Model Context Protocol (MCP)**: Built-in stdio and HTTP MCP server exposing knowledge graph tools, pipeline execution, and domain schema suggestions.

---

## MCP Server Integration Guidelines
When assisting users with setup, data ingestion, or pipeline execution:
1. **Stdio MCP Server**: Run `npm run mcp` or `npm run mcp:dev`.
2. **HTTP SSE MCP Server**: Run `npm run mcp:http` (exposes endpoints on port `3000`/`5000` at `/sse` & `/message`).
3. **Core MCP Tools**:
   - `search_knowledge_graph` & `create_entity`: Query and populate entities in the causal graph.
   - `create_relationship`: Connect signal primitives to downstream target cycles.
   - `suggest_schema`: Generate domain ontology from natural language descriptions.
   - `run_pipeline` & `get_pipeline_execution_status`: Trigger and monitor governed cycles.

---

## Spatial Intelligence & Signal Routing Rules
- **Signal Sources**: Configured in `signal_feeds` table (supports RSS, Webhooks, REST APIs).
- **Event Primitives**: Normalized events ingested into `event_primitives` with severity (`Low`, `Medium`, `High`, `Critical`) and target sector.
- **Cycle Subscriptions**: Rules in `cycle_signal_subscriptions` linking event types to `operational_cycles` via `deliveryMode: 'context_only'` or `'trigger_step'`.
