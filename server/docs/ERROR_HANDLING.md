# Error Handling & Logging System

## Overview

This system provides structured logging with correlation IDs, standardized error responses, and comprehensive debugging support.

## Key Features

1. **Correlation IDs** - Every request gets a unique ID for tracing
2. **Structured Logging** - JSON logs in production, pretty-printed in development
3. **Error Codes** - Unique codes for every error type
4. **Automatic Sanitization** - Sensitive data (passwords, tokens) is redacted
5. **Performance Tracking** - Request duration logging with slow request warnings

## Usage

### Logger

```typescript
import { createLogger, Logger } from '../utils/logger';

// Create a component-specific logger
const logger = createLogger('MyComponent');

// Log messages with different levels
logger.debug('Debug message', { someContext: 'value' });
logger.info('User logged in', { userId: 123 });
logger.warn('Resource running low', { remaining: 10 });
logger.error('Failed to process', error, { jobId: 456 });
logger.fatal('Critical system failure', error);

// Log with timing
const stopTimer = logger.time('Database query');
await db.query('...');
stopTimer(); // Logs: "Database query completed (duration: 45ms)"

// Async operation with automatic timing and error logging
const result = await logger.withTiming('Fetch user data', async () => {
  return await userService.getUser(id);
}, { userId: id });
```

### Pre-configured Loggers

```typescript
import { 
  pipelineLogger, 
  jobLogger, 
  apiLogger, 
  authLogger,
  dbLogger,
  aiLogger,
  schedulerLogger,
  webhookLogger,
  knowledgeLogger 
} from '../utils/logger';

// Use in appropriate components
pipelineLogger.info('Pipeline started', { pipelineId, executionId });
jobLogger.error('Job execution failed', error, { jobId });
aiLogger.warn('Rate limit approaching', { provider: 'openai', remaining: 5 });
```

### Error Handling

```typescript
import { 
  BadRequestError, 
  NotFoundError, 
  JobNotFoundError,
  JobExecutionError,
  ErrorCode 
} from '../utils/errors';
import { asyncHandler } from '../middleware';

// In routes, use asyncHandler to catch errors
router.get('/jobs/:id', asyncHandler(async (req, res) => {
  const job = await storage.getJob(req.params.id);
  if (!job) {
    throw new JobNotFoundError(req.params.id);
  }
  res.json(job);
}));

// Custom error with details
throw new BadRequestError('Invalid configuration', {
  field: 'url',
  reason: 'URL format is invalid'
}, ErrorCode.INVALID_FORMAT);

// Job execution error
throw new JobExecutionError(jobId, 'Failed to connect to API', {
  url: config.url,
  statusCode: 500
});
```

### Error Codes

All errors include a code for programmatic handling:

| Code | Description | HTTP Status |
|------|-------------|-------------|
| `VALIDATION_FAILED` | Input validation failed | 400 |
| `INVALID_INPUT` | Generic invalid input | 400 |
| `UNAUTHORIZED` | Authentication required | 401 |
| `FORBIDDEN` | Access denied | 403 |
| `JOB_NOT_FOUND` | Job doesn't exist | 404 |
| `PIPELINE_NOT_FOUND` | Pipeline doesn't exist | 404 |
| `CREDENTIAL_NOT_FOUND` | Credential doesn't exist | 404 |
| `JOB_EXECUTION_FAILED` | Job execution error | 500 |
| `AI_PROVIDER_ERROR` | AI service error | 502 |

### Error Response Format

All errors return this standardized format:

```json
{
  "success": false,
  "error": {
    "code": "JOB_NOT_FOUND",
    "message": "Job 123 not found",
    "statusCode": 404,
    "details": { "jobId": 123 }
  },
  "correlationId": "abc123de",
  "timestamp": "2024-12-25T08:45:00.000Z",
  "path": "/api/jobs/123"
}
```

### Request Middleware

Add to Express app:

```typescript
import { requestMiddleware, errorHandler, notFoundHandler } from '../middleware';

// Add correlation ID and request logging
app.use(requestMiddleware);

// ... your routes ...

// Handle 404s
app.use(notFoundHandler);

// Handle all errors
app.use(errorHandler);
```

### Using Request Context

The correlation ID is available on every request:

```typescript
router.get('/example', asyncHandler(async (req, res) => {
  // Access correlation ID
  const correlationId = req.correlationId;
  
  // Use the request-scoped logger
  req.logger.info('Processing request');
  
  // Include in downstream calls
  await fetch('https://api.example.com', {
    headers: {
      'X-Correlation-Id': correlationId
    }
  });
}));
```

## Log Output Examples

### Development (Pretty Print)

```
10:45:23 [INFO ] (abc123de) [Pipeline] Pipeline started
  {
    "pipelineId": 5,
    "executionId": 42
  }
10:45:24 [ERROR] (abc123de) [Job] Job execution failed
  Error: BadRequestError: Invalid API response
    at executeJob (/server/job-executor.ts:45:11)
    at processPipeline (/server/pipeline.ts:120:5)
```

### Production (JSON)

```json
{"timestamp":"2024-12-25T18:45:23.456Z","level":"INFO","message":"Pipeline started","correlationId":"abc123de","component":"Pipeline","context":{"pipelineId":5,"executionId":42}}
{"timestamp":"2024-12-25T18:45:24.789Z","level":"ERROR","message":"Job execution failed","correlationId":"abc123de","component":"Job","error":{"name":"BadRequestError","message":"Invalid API response","code":"INVALID_INPUT"}}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `INFO` | Minimum log level (DEBUG, INFO, WARN, ERROR, FATAL) |
| `NODE_ENV` | `development` | Environment mode (affects log formatting) |

## Migration Guide

### Before (old pattern):

```typescript
try {
  // ... 
} catch (error: any) {
  console.error('Error:', error);
  res.status(500).json({ message: error.message });
}
```

### After (new pattern):

```typescript
import { asyncHandler } from '../middleware';
import { createLogger } from '../utils/logger';

const logger = createLogger('MyRoute');

// Error handling is automatic with asyncHandler
router.get('/example', asyncHandler(async (req, res) => {
  // Throw errors directly - they'll be caught and logged
  if (!data) throw new NotFoundError('Data not found');
  res.json(data);
}));

// For manual error logging with context:
router.post('/example', asyncHandler(async (req, res) => {
  try {
    await riskyOperation();
  } catch (error) {
    logger.error('Risky operation failed', error, { 
      correlationId: req.correlationId,
      userId: req.session?.userId 
    });
    throw error; // Re-throw to trigger error handler
  }
}));
```
