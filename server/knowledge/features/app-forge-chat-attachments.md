# App Forge Chat Attachments & Scribe-Style Requirements Ingestion

## Overview

The App Forge Chat Attachment & Requirement Ingestion system enables users to bring rich multi-format assets into group chat discussions with specialized agent squads, synthesize architectural feedback, and insert structured requirements into active App Forge projects with a single click.

## Supported Formats & Capabilities

The CREW chat attachment system accepts files across multiple modalities:
- **Diagrams & Flowcharts**: BPMN (`.bpmn`), Draw.io/XML diagrams (`.xml`), vector graphics (`.svg`), and workflow diagrams.
- **Images & Wireframes**: PNG (`.png`), BMP (`.bmp`), JPEG (`.jpg`, `.jpeg`), WebP (`.webp`), GIF (`.gif`). Process images are automatically OCR-analyzed and inferred into process graphs.
- **Structured Data & Spreadsheets**: CSV (`.csv`), Excel (`.xlsx`, `.xls`), JSON (`.json`), YAML (`.yaml`, `.yml`).
- **Documents & Specifications**: Word (`.docx`), PDF (`.pdf`), Markdown (`.md`), Plain Text (`.txt`).

## Architecture & Data Flow

### 1. Attachment Scoping & Ingestion
- Uploads hit `POST /api/crew/:sessionKey/attachments` with multi-tenant org isolation (`orgId`).
- If a room does not have an explicit `projectId`, the route automatically resolves the organization's default project space via `projectService.resolveDefaultProjectId(orgId)` and associates the session, guaranteeing that cold rooms and App Forge sessions can always ingest attachments without error.
- Files are parsed asynchronously: text is extracted, process graphs are synthesized, and embeddings are queued for RAG search via `attachmentIndexService`.

### 2. Specialized Agent Squad Evaluation
When App Forge Studio is mounted or requested:
- A dedicated squad is automatically activated in CREW chat:
  - **Knowledge Architect / Analyst**: Evaluates spreadsheets, CSVs, schemas, and domain data models.
  - **Systems / Backend Architect**: Evaluates process graphs, BPMN workflows, API routes, and service boundaries.
  - **Coder / Software Engineer**: Evaluates UI components, frontend widgets, and implementation scaffolds.
  - **Security Auditor**: Checks authentication, role-based access controls, and data sanitization.
  - **Copilot**: Bridges requirements between the user and squad members.
- An **Attachment Evaluation Directive** is automatically injected into the turn instruction when users mention attachments, flowcharts, schemas, or specifications. Agents leverage `list_attachments`, `get_attachment_text`, and `search_attachments` to ground their answers in the uploaded documents.

### 3. Scribe-Style 1-Click Requirement Insertion
Mirroring the Scribe Studio interaction model (`scribe:insert-text`), App Forge provides seamless insertion of agent analysis into specifications:
- **Filtering & Stripping**: `forgeRequirementFrom(content)` strips conversational chatter, greetings, and closing handoffs, preserving pure requirements, API endpoints, schema definitions, and markdown code blocks.
- **Action Affordance**: When App Forge Studio is open (`hasAppStudioActive`), turns with extractable specifications render an **"Add to App Requirements"** action button.
- **Event Dispatch**: Clicking dispatches `forge:add-requirement` with `{ text, agentName }`.
- **App Studio Integration**: `AppStudioPod.tsx` listens for the event, appends the attributed text (`### [Specification from @agentName]`) to `customRequirements`, and automatically switches the active tab to the specifications walkthrough (`"specs"`), showing the user the updated requirements immediately.
