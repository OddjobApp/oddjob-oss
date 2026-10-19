# Oddjob CLI

Command-line interface for managing Oddjob pipelines, jobs, and workflows.

## Installation

### Global Installation
```bash
npm install -g @oddjob/cli
```

### Local Development
```bash
cd cli
npm install
npm link
```

## Quick Start

### Configure CLI
```bash
# Set API URL
oddjob config set apiUrl http://localhost:5000

# Set auth token (if required)
oddjob config set authToken your-token-here

# Set default organization
oddjob config set defaultOrg 1
```

### Deploy a Pipeline
```bash
# From YAML file
oddjob deploy pipeline.yaml

# From JSON file
oddjob deploy pipeline.json

# Dry run (validate only)
oddjob deploy pipeline.yaml --dry-run

# Specify organization
oddjob deploy pipeline.yaml --org 2
```

### Execute a Pipeline
```bash
# By ID
oddjob run 123

# By name
oddjob run "My Pipeline"

# With input data
oddjob run 123 --input '{"key": "value"}'

# From input file
oddjob run 123 --input-file input.json

# Wait for completion
oddjob run 123 --wait

# With custom timeout
oddjob run 123 --wait --timeout 600
```

### View Logs
```bash
# View execution logs
oddjob logs 456

# Follow logs in real-time
oddjob logs 456 --follow

# Show logs for specific step
oddjob logs 456 --step 3

# Output as JSON
oddjob logs 456 --json
```

### Interactive Agent Chat Loop
```bash
# Start an interactive session to plan, launch, and steer missions in real-time
oddjob chat
```
Inside the interactive chat shell, you can enter objectives, view plans, see live agent execution thought logs, and approve/reject governed tool proposals (`y/n`) directly.

### Manage Credentials
```bash
# Add a credential
oddjob creds add openai --type ai_provider --key sk-xxx --env OPENAI_API_KEY

# List credentials
oddjob creds list

# Filter by organization
oddjob creds list --org 1

# Delete a credential
oddjob creds delete 5
```

## Pipeline Definition Format

### YAML Example
```yaml
name: "Data Processing Pipeline"
description: "Process and analyze data"
organizationId: 1
steps:
  - name: "Fetch Data"
    jobType: "curl"
    config:
      url: "https://api.example.com/data"
      method: "GET"
    
  - name: "Transform Data"
    jobType: "transformer"
    config:
      rules:
        - field: "$.data"
          operation: "extract"
    
  - name: "Store Results"
    jobType: "file_export"
    config:
      destinationPath: "/output/results.json"
      format: "json"
```

### JSON Example
```json
{
  "name": "Data Processing Pipeline",
  "description": "Process and analyze data",
  "organizationId": 1,
  "steps": [
    {
      "name": "Fetch Data",
      "jobType": "curl",
      "config": {
        "url": "https://api.example.com/data",
        "method": "GET"
      }
    }
  ]
}
```

## Configuration

Configuration is stored in `~/.oddjob/config.json`

Available settings:
- `apiUrl`: Oddjob API URL (default: http://localhost:5000)
- `authToken`: Authentication token
- `defaultOrg`: Default organization ID
- `outputFormat`: Output format (json, table, yaml)

## Environment Variables

- `ODDJOB_API_URL`: Override API URL
- `ODDJOB_AUTH_TOKEN`: Override auth token

## Examples

### CI/CD Integration
```bash
#!/bin/bash
# deploy-pipeline.sh

# Configure CLI
oddjob config set apiUrl $ODDJOB_URL
oddjob config set authToken $ODDJOB_TOKEN

# Deploy pipeline
oddjob deploy pipelines/production.yaml

# Execute and wait
oddjob run "Production Pipeline" --wait --timeout 1800
```

### Automated Testing
```bash
# Test pipeline deployment
oddjob deploy test-pipeline.yaml --dry-run

# Execute test pipeline
EXECUTION_ID=$(oddjob run "Test Pipeline" --wait --json | jq -r '.id')

# Check results
oddjob logs $EXECUTION_ID --json | jq '.steps[] | select(.status == "failed")'
```

## Troubleshooting

### Connection Issues
```bash
# Check API connectivity
curl $ODDJOB_API_URL/health

# Verify configuration
oddjob config list
```

### Authentication Errors
```bash
# Set auth token
oddjob config set authToken your-token

# Or use environment variable
export ODDJOB_AUTH_TOKEN=your-token
```

## Development

### Building
```bash
npm run build
```

### Testing
```bash
npm test
```

### Publishing
```bash
npm version patch
npm publish
```
