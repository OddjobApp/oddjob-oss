# App Forge MCP Tools - Quick Reference

## Overview
All App Forge tools are now exposed via the MCP (Model Context Protocol) for both HTTP/SSE and stdio transports.

## Available Tools

### Core Forge Tools

| Tool | Purpose | Key Parameters |
|------|---------|---------------|
| `forge_app` | Scaffold new app from blueprint | `blueprint`, `name`, `slug`, `description`, `systemPrompt?` |
| `list_blueprints` | List available blueprints | (none) |
| `get_forge_status` | Check forge job progress | `jobId` |

### Build Hardening Tools

| Tool | Purpose | Key Parameters |
|------|---------|---------------|
| `forge_sanitize_deps` | Strip AI-hallucinated packages | `slug`, `blueprintSlug` |
| `forge_inject_build_config` | Inject tsconfig/next.config | `slug` |
| `forge_validate_workspace` | Pre-flight build validation | `slug` |

### Development Tools

| Tool | Purpose | Key Parameters |
|------|---------|---------------|
| `forge_edit_file` | Edit/create workspace files | `slug`, `filePath`, `content` |
| `forge_npm_command` | Run npm in workspace | `slug`, `command` |

### Studio Tools

| Tool | Purpose | Key Parameters |
|------|---------|---------------|
| `studio_list_files` | List file tree | `slug` |
| `studio_read_file` | Read file content | `slug`, `filePath` |
| `studio_enhance_app` | AI-powered enhancement | `appId`, `instruction` |

### Utility Tools

| Tool | Purpose | Key Parameters |
|------|---------|---------------|
| `search_hil_context` | Search past HIL decisions | `query`, `limit?` |

## Example Usage

### HTTP/SSE Transport
```bash
curl -X POST http://localhost:3001/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "forge_app",
      "arguments": {
        "blueprint": "analytics-dashboard",
        "name": "My App",
        "slug": "my-app",
        "description": "An analytics dashboard"
      }
    }
  }'
```

### Stdio Transport
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "forge_app",
    "arguments": {
      "blueprint": "analytics-dashboard",
      "name": "My App",
      "slug": "my-app",
      "description": "An analytics dashboard"
    }
  }
}
```

## Implementation Details

### Files Modified
- `server/mcp/tools/app-forge.ts` - Tool definitions
- `server/mcp/handlers/forge.ts` - Handlers (12 functions)
- `server/mcp/handlers.ts` - Dispatcher
- `server/mcp/http-server.ts` - HTTP/SSE server
- `server/mcp/index.ts` - Stdio server

### App Launch Notifications
When an app is successfully forged and published, Oddjob automatically sends a notification to the organization's connected Slack workspace (if configured) with:
- App name and deployment URL
- "Open App" and "View in Builder" action buttons
- App ID and organization information

### Error Handling
All tools return standardized responses:
```typescript
{ success: true, ...data } // Success
{ success: false, error: string } // Failure
```

### Rate Limit Protection
The underlying forge services use `executeWithBackoff` with:
- 3 retry attempts
- Exponential backoff (5s → 10s → 20s)
- 429 error detection

### JSON Auto-Repair
The forge services use `tryFixJson` for:
- Missing commas
- Trailing commas
- Unclosed braces/brackets
- Escaped character fixes
