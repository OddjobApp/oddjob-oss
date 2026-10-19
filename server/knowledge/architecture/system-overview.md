# System Architecture & Internals

> **SCOPE WARNING**: This document contains internal engineering details. It should only be referenced when the user explicitly monitors "System Architecture" context or asks about internal implementation.

## Tech Stack
- **Runtime**: Node.js (TypeScript)
- **Framework**: Express.js
- **Database**: PostgreSQL (via Drizzle ORM @ `server/db.ts`)
- **Vector DB**: Qdrant (for RAG and Knowledge Graph @ `server/services/knowledge/qdrant-client.ts`)
- **Frontend**: React + Vite + TailwindCSS
- **AI Provider**: Google Gemini (Primary), OpenAI (Fallback)

## Core Services

### 1. Agent Service (`server/services/agent/agent-service.ts`)
The central nervous system. It:
- **Orchestrates** AI agents (running LLM loops).
- **Manages** tool execution and result parsing.
- **Maintains** chat history and context.

### 2. System Context Service (`server/services/system-context-service.ts`)
Responsible for **grounding** the AI.
- Generates dynamic system prompts including Schema definitions, Tool descriptions (MCP), and Activity Types.
- Caches these prompts in Redis to reduce latency.

### 3. Ingestion Service (`server/services/knowledge/system-ingestion-service.ts`)
Scans the codebase to populate the Knowledge Graph.
- **Source**: TypeScript files, Markdown docs, Database Schema.
- **Destination**: Knowledge Graph (nodes and edges).
- **Purpose**: Allows the AI to "know" the codebase structure.

### 4. Dataset Service (`server/services/dataset-service.ts`)
Standardized access to structured external data.
- **Connectors**: Syncs data from Jira, GitHub, and custom API endpoints.
- **Storage**: Maps normalized data into structured Postgres tables.
- **Discovery**: Provides metadata and query tools for agents to explore non-graph data.

### 5. Prompt Service (`server/services/ai/prompt-service.ts`)
Builds the final system prompt sent to the LLM.
- **Context Partitioning**: Injects filtered context based on user scope (`OPERATIONAL`, `SYSTEM_ARCH`, `GENERAL`).
- **Smart Refusal**: Guides users to the correct context if they ask out-of-scope questions.
- **Persona Management**: Configures specialized personas like "Knowledge Engine & Data Explorer" for holistic data research.

## Data Model (Key Schemas)
Defined in `@shared/schema`:
- **`jobs`**: Configuration for automated tasks. Linked to `pipelines`.
- **`pipelines`**: Sequences of jobs.
- **`knowledge_nodes`**: Entities in the Knowledge Graph. Linked via `knowledge_edges`.
- **`workgroups`**: Collaborative teams of agents working on missions.
- **`missions`**: Active execution cycles of workgroups.
- **`agent_chat_messages`**: History of user-agent interactions.
- **`blackboard`**: Dynamic shared memory for workgroups.

## Key Concepts
- **MCP Tools**: Modular tools compliant with Model Context Protocol. Exposed via `server/mcp/`.
- **Knowledge Graph**: A directed graph representing the user's domain AND the system's own architecture. Edges define relationships like `DEPENDS_ON`, `CALLS`, `DEFINES`.
- **Activity Types vs Tasks**:
    - **Activity Type (Job Type)**: The definition of *what* can be done (e.g., `shell_script`, `http_request`).
    - **Task (Job)**: A specific *instance* of an Activity Type configured with parameters.
