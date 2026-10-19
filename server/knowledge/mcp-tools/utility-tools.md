# Utility MCP Tools

## Database

### sql_query
Execute SQL queries against the database.
```
sql_query(query: string)
```

**Table Names**:
- `jobs`, `pipelines`, `schedules`, `scheduled_jobs`
- `job_runs`, `pipeline_runs`
- `alerts`, `credentials`

## System Status

### get_system_health
Check overall system status.
```
get_system_health()
```
Returns: Health status, component checks, resource usage

### list_failed_jobs
Get recent job failures.
```
list_failed_jobs(limit?: number, since?: string)
```

## Time & Math

### current_time
Get current timestamp.
```
current_time(timezone?: string)
```

### calculator
Perform calculations.
```
calculator(expression: string)
```

## Credentials

### list_credentials
List available credentials (metadata only).
```
list_credentials(type?: string)
```

### get_credential_info
Get credential metadata.
```
get_credential_info(credentialId: number)
```
Note: Actual secrets are never exposed.

## Documents

### search_documents
Semantic search across documents.
```
search_documents(query: string, limit?: number, minScore?: number)
```

### list_documents
List all documents.
```
list_documents(limit?: number, search?: string)
```

### get_document_content
Get full document content.
```
get_document_content(documentId: number)
```
