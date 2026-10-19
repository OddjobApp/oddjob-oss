# Oddjob MCP Server

**Model Context Protocol (MCP) Server** for exposing Oddjob's capabilities to AI clients like Claude Desktop, Cursor IDE, Onyx AI, and other MCP-compatible tools.

## Quick Start

```bash
# Run the MCP server via stdio (for local clients like Claude Desktop)
npm run mcp

# Run stdio server in development mode (with tsx)
npm run mcp:dev

# Run HTTP/SSE MCP server (for remote clients like Onyx AI)
npm run mcp:http
```

## Transport Options

### Stdio Transport (Default)
For local AI clients that spawn the MCP server as a child process:
- Claude Desktop
- Cursor IDE
- Local MCP clients

### HTTP/SSE Transport
For remote AI clients that connect via HTTP:
- Onyx AI
- Custom web applications
- Server-to-server integrations

**HTTP Endpoints:**
- `GET /health` - Health check
- `GET /sse` - SSE endpoint for MCP connection
- `POST /message` - Client-to-server messages


## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `ODDJOB_ORG_ID` | No | `1` | Organization ID to scope data |

### Claude Desktop Setup

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "oddjob": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/path/to/oddjob",
      "env": {
        "DATABASE_URL": "postgresql://...",
        "ODDJOB_ORG_ID": "1"
      }
    }
  }
}
```

## Available Tools

### Knowledge Graph

| Tool | Description |
|------|-------------|
| `search_knowledge_graph` | Search entities by name and type |
| `get_entity_impact` | Analyze entity dependencies (impact analysis) |
| `create_entity` | Create a new entity in the graph |
| `create_relationship` | Create a relationship between entities |
| `suggest_schema` | Generate ontology from domain description |
| `get_graph_statistics` | Get summary stats of the graph |

### Pipelines

| Tool | Description |
|------|-------------|
| `list_pipelines` | List all automation pipelines |
| `get_pipeline_details` | Get details of a specific pipeline |
| `run_pipeline` | Trigger pipeline execution |
| `get_pipeline_execution_status` | Check execution status |
| `list_recent_executions` | List recent pipeline runs |

### Documents

| Tool | Description |
|------|-------------|
| `search_documents` | Search documents by content |
| `list_documents` | List all documents |
| `get_document_content` | Get full document content |

### System & Discovery

| Tool | Description |
|------|-------------|
| `list_available_mcp_capabilities` | Browse inactive MCP capabilities and identify missing tools |
| `request_mcp_tool` | Request real-time activation of an MCP capability (triggers Triage session) |
| `delegate_task` | Spawn a specialized sub-agent for a sub-mission (supports recursive tracking) |

## Available Resources

Resources provide read-only access to data:

| URI | Description |
|-----|-------------|
| `oddjob://knowledge/nodes` | All knowledge graph entities |
| `oddjob://knowledge/schemas` | Graph schema definitions |
| `oddjob://knowledge/statistics` | Entity and relationship counts |
| `oddjob://pipelines` | All automation pipelines |
| `oddjob://documents` | All knowledge documents |

## Prompts

Pre-built prompt templates for common workflows:

| Prompt | Description |
|--------|-------------|
| `knowledge_analyst` | Analyze knowledge graph relationships |
| `pipeline_operator` | Manage and operate pipelines |
| `document_search` | Search documentation |
| `impact_analysis` | Analyze change impact on an entity |

## Example Conversations

### Querying the Knowledge Graph

**User to Claude:**
> What entities are connected to the Payment Service?

**Claude uses:**
1. `search_knowledge_graph` with query "Payment Service"
2. `get_entity_impact` with entity found

### Running a Pipeline

**User to Claude:**
> Run the daily JIRA sync pipeline

**Claude uses:**
1. `list_pipelines` to find the pipeline
2. `run_pipeline` with dryRun first, then execute
3. `get_pipeline_execution_status` to monitor

### Impact Analysis

**User to Claude:**
> What would be affected if we deprecate the User Database?

**Claude uses:**
1. `search_knowledge_graph` for "User Database"
2. `get_entity_impact` with direction "both"
3. Synthesizes risk assessment

## Development

### File Structure

```
server/mcp/
├── index.ts           # Main MCP server entry point
├── handlers.ts        # Tool execution handlers  
├── tools/
│   ├── knowledge-graph.ts  # KG tool definitions
│   ├── pipelines.ts        # Pipeline tool definitions
│   └── documents.ts        # Document tool definitions
└── README.md          # This file
```

### Adding New Tools

1. Add tool definition in `tools/` with inputSchema
2. Add Zod validation schema
3. Implement handler in `handlers.ts`
4. Register in `handleToolCall` router

## License

MIT
