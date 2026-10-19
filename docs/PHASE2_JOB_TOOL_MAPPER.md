# Phase 2: Job-to-Tool Mapper Enhancement

## Summary

Strengthened the `JobToToolMapper` to provide rich, type-safe tool definitions for AI agents. Previously, most job types fell back to a generic "App Proxy" with only an `input` string parameter. Now, each major job type has a specialized mapping with proper Zod schemas.

## Changes Made

### File: `@server/domain/tools/v1/job-to-tool-mapper.ts`

**Before**: 113 lines, only `dispatcher` had specialized mapping, all others used generic fallback with `input: string`

**After**: 713 lines, 13 specialized mappings + improved generic fallback

### New Job Type Categories

Organized all job types into logical groups:

| Group | Job Types |
|-------|-----------|
| HTTP | curl, api |
| Scripting | shell, python, node_script |
| Database | sql_query |
| AI | ai_agent, ai_api_call, reranker, supervisor, form_agent |
| Integration | dispatcher, slack_post, email_send, teams_post, openapi, airflow_dag_run |
| Automation | selenium |
| File System | file_ops, folder_import, file_export, file_writer |
| Version Control | git_op, github_op |
| Sync | confluence_sync, jira_sync, google_drive_sync, github_sync, sharepoint_sync, youtube_sync |
| Data | transformer, static_response |
| Flow Control | iterator, decision, repeater |
| Human-in-Loop | human_approval |
| Cloud | cloud_function |
| Monitoring | monitoring_query |

### Specialized Mappings

#### 1. HTTP Jobs (curl/api)
**Parameters:**
- `url`: Target URL or path
- `method`: GET, POST, PUT, PATCH, DELETE
- `headers`: Key-value HTTP headers
- `queryParams`: Query parameters
- `body`: Request body
- `authType`: none, bearer, basic

**Before:** Just `input: string`
**After:** Full HTTP request control

#### 2. Shell Jobs
**Parameters:**
- `command`: Shell command to execute
- `parameters`: Additional arguments
- `workingDirectory`: Execution context

#### 3. Python Jobs
**Parameters:**
- `script`: Python code to execute
- `requirements`: Additional pip dependencies

#### 4. SQL Query Jobs
**Parameters:**
- `query`: SQL query string
- `parameters`: Prepared statement parameters
- `outputMode`: list (all rows) or single (first result)

#### 5. AI Agent Jobs
**Parameters:**
- `goal`: The task for the agent
- `persona`: generic, researcher, critic, analyst, creator, strategist, debugger
- `maxIterations`: Thinking limit
- `allowedTools`: Specific tool whitelist

#### 6. AI API Call Jobs
**Parameters:**
- `prompt`: User prompt
- `systemPrompt`: System instructions
- `temperature`: 0-2 creativity control
- `maxTokens`: Response limit
- `responseFormat`: json or text

#### 7. Slack Post Jobs
**Parameters:**
- `channel`: Channel ID or name
- `message`: Message text

#### 8. Email Send Jobs
**Parameters:**
- `to`: Recipient(s)
- `subject`: Email subject
- `body`: Email content
- `isHtml`: HTML flag

#### 9. Selenium Jobs
**Parameters:**
- `url`: Starting URL
- `goal`: AI-driven automation goal
- `steps`: JSON array of automation steps

#### 10. File Operations Jobs
**Parameters:**
- `operation`: copy, move, delete, list, create_dir
- `sourcePath`: Source file/directory
- `destinationPath`: Target path
- `recursive`: Directory recursion flag

#### 11. Folder Import Jobs
**Parameters:**
- `folderPath`: Directory to import
- `pattern`: File glob pattern
- `recursive`: Include subdirectories
- `mode`: list_only, read_content, ingest_dataset

#### 12. Transformer Jobs
**Parameters:**
- `input`: JSON data to transform
- `rules`: JSON array of transformation rules

#### 13. Dispatcher Jobs (Enhanced)
**Parameters:**
- `serviceType`: Type of service
- `location`: Physical address
- `lat`, `lng`: GPS coordinates
- `notes`: Additional context

### Improvements to Generic Fallback

For job types without specialized mappings:
- Better error messages
- JSON parsing attempt with fallback to raw string
- Warning logged to encourage adding specialized mapping
- Proper group assignment

### Error Handling

All mappings now include:
- Executor existence checks with descriptive errors
- Input validation via Zod schemas
- JSON parsing error handling where applicable
- Consistent logging via `createLogger`

## Impact

### For AI Agents
- **Before**: "I have this tool but I don't know what parameters it needs"
- **After**: "I can see exactly what parameters each job expects and their types"

### For Developers
- **Before**: Had to manually construct JSON strings for job execution
- **After**: Type-safe parameters with IDE autocomplete support

### For Job Authors
- **Before**: Jobs published as tools had no discoverable interface
- **After:** Jobs expose clear, documented interfaces to AI agents

## Testing

To verify the enhanced mappings work correctly:

```typescript
// Test curl job mapping
const curlJob = { type: 'curl', name: 'Test API', config: { url: 'https://api.example.com' } };
const curlTool = JobToToolMapper.mapJobToTool(curlJob);
console.log(curlTool.parameters.shape); // Should show url, method, headers, etc.

// Test AI agent job mapping
const agentJob = { type: 'ai_agent', name: 'Researcher', config: { model: 'gpt-4' } };
const agentTool = JobToToolMapper.mapJobToTool(agentJob);
console.log(agentTool.parameters.shape); // Should show goal, persona, maxIterations, etc.
```

## Future Enhancements (Phase 3 Ideas)

1. **Dynamic Schema Generation**: Generate Zod schemas from job config schemas automatically
2. **Parameter Validation Middleware**: Pre-execution validation with detailed error messages
3. **Tool Composition**: Allow chaining multiple jobs as a single tool
4. **Conditional Parameters**: Show/hide parameters based on other parameter values
5. **Documentation Generation**: Auto-generate tool documentation from schemas

## Related Files

- `@server/domain/tools/v1/job-to-tool-mapper.ts` - Main implementation
- `@server/domain/jobs/core/executors/index.ts` - Executor registry
- `@shared/schema/jobs/*.ts` - Job configuration schemas
