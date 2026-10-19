# Credentials Feature

## Overview
Credentials store authentication details for external services, used by jobs and pipelines.

## Credential Types

| Type | Use Case | Fields |
|------|----------|--------|
| `basic` | HTTP Basic Auth | username, password |
| `bearer` | API Token | token |
| `oauth2` | OAuth 2.0 | clientId, clientSecret, tokenUrl |
| `api_key` | API Key | key, headerName |
| `jira` | JIRA Cloud/Server | baseUrl, email, apiToken |
| `database` | Database connections | host, port, user, password, database |

## Using Credentials in Jobs

### CURL Job with Credential
```json
{
  "type": "curl",
  "url": "/api/endpoint",
  "method": "GET",
  "credentialId": 5,
  "authType": "bearer"
}
```

### SQL Query with Database Credential
```json
{
  "type": "sql_query",
  "query": "SELECT * FROM users",
  "credentialId": 3
}
```

## Security Notes
- Credential values are encrypted at rest
- Only credential metadata is visible via API
- Actual secrets are never exposed to the UI
- Use `list_credentials` to find available credentials

## User Help Scenarios

| Scenario | Response |
|----------|----------|
| "Set up JIRA integration" | Check for existing JIRA credential, guide creation |
| "API returning 401" | Verify credential ID, check if token expired |
| "How do I add a new API key" | Navigate to Credentials page, create type: api_key |
