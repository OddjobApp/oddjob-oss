# Job MCP Tools

## Read Operations

### list_jobs
List all jobs in the organization.
```
list_jobs(search?: string, type?: string, limit?: number)
```
**Use when**: User asks "what jobs exist", "show my jobs", browsing jobs

### get_job_details
Get detailed configuration for a specific job.
```
get_job_details(jobId?: number, jobName?: string)
```
**Use when**: User asks about a specific job, viewing job config

### get_job_schema
Get the configuration schema for a job type.
```
get_job_schema(jobType: string)
```
**Use when**: Creating a job, explaining config options, debugging config errors

## Write Operations (Admin Only)

### create_job
Create a new job definition.
```
create_job(name: string, type: string, config: object, description?: string)
```
**Use when**: User wants to automate something new

### update_job
Modify an existing job.
```
update_job(jobId: number, name?: string, config?: object, isActive?: boolean)
```
**Use when**: User wants to change job behavior

### delete_job
Remove a job.
```
delete_job(jobId: number)
```
**Use when**: Cleaning up unused jobs (check for pipeline dependencies first!)

## Usage Patterns

### Before Creating a Job
1. Call `get_job_schema(type)` to understand config structure
2. Verify credentials with `list_credentials`
3. Create with correct config

### Debugging a Job
1. `get_job_details(jobId)` to see config
2. `list_recent_executions` to check history
3. Compare config against schema
