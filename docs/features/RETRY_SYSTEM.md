# Automatic Retry System

## Overview

The Automatic Retry System provides resilient mission execution by automatically retrying failed operations with exponential backoff. It integrates with the Circuit Breaker to prevent retry storms and includes a Dead Letter Queue for persistent failures.

## Purpose

- **Handle transient failures** - Network timeouts, rate limits, temporary unavailability
- **Exponential backoff** - Prevents overwhelming failing services
- **Jitter** - Avoids thundering herd problems
- **Dead Letter Queue** - Captures failures needing manual intervention
- **Circuit Breaker Integration** - Stops retries when circuits are open

## Architecture

### Retry Flow

```
Execute Tool
    ↓
Success → Record Success → Return Result
    ↓
Failure
    ↓
Retryable? → No → Add to DLQ → Throw Error
    ↓
Yes
    ↓
Check Circuit → Open? → Use Fallback / Fail Fast
    ↓
Closed → Wait (Backoff) → Retry
    ↓
Max Attempts? → Yes → Add to DLQ → Throw Error
```

### Exponential Backoff Formula

```
delay = min(baseDelay × 2^(attempt-1), maxDelay)
with jitter: delay ± 25% random variance
```

Default configuration:
- Base delay: 1000ms
- Max delay: 30000ms (30s)
- Multiplier: 2
- Jitter: enabled

## MCP Tools

### get_dead_letter_queue
View failed operations that exhausted all retries.

**Input:**
```json
{
  "toolName": "search_api",
  "limit": 20,
  "since": "2024-01-01T00:00:00Z"
}
```

**Output:**
```json
{
  "success": true,
  "data": {
    "entries": [
      {
        "id": "dl_1713742800000_abc123",
        "toolName": "search_api",
        "error": "Connection timeout",
        "attempts": 3,
        "timestamp": "2024-04-21T10:30:00Z",
        "correlationId": "corr_xyz789_1713742800000",
        "missionRunId": 123
      }
    ],
    "count": 1
  }
}
```

### replay_dead_letter
Retry a failed operation from the DLQ.

**Input:**
```json
{
  "entryId": "dl_1713742800000_abc123"
}
```

### remove_dead_letter
Remove an entry from the DLQ (for acknowledged failures).

**Input:**
```json
{
  "entryId": "dl_1713742800000_abc123"
}
```

### get_retry_stats
Get retry service statistics.

**Output:**
```json
{
  "success": true,
  "data": {
    "activeRetries": 5,
    "deadLetterCount": 12,
    "deadLetterByTool": {
      "search_api": 8,
      "file_upload": 4
    }
  }
}
```

## Usage

### Basic Retry

```typescript
import { missionRetryService } from "./retry.service.js";

const result = await missionRetryService.execute(
    "external_api",
    async () => await callExternalApi(args),
    {
        maxAttempts: 5,
        baseDelay: 2000,
    },
    { missionRunId: 123 }
);

if (result.success) {
    console.log(`Success after ${result.attempts} attempts`);
} else {
    console.log(`Failed after ${result.attempts} attempts`);
}
```

### Quick Retry

```typescript
const result = await missionRetryService.retry(
    async () => await fetchData(),
    {
        attempts: 3,
        delay: 1000,
        onRetry: (attempt, error) => {
            console.log(`Retry ${attempt}: ${error.message}`);
        }
    }
);
```

### Decorator Pattern

```typescript
import { withRetry } from "./retry.service.js";

class MyService {
    @withRetry({ maxAttempts: 3, baseDelay: 1000 })
    async callExternalApi(args: any) {
        // Will retry automatically on failure
        return await fetchFromApi(args);
    }
}
```

## Configuration

### RetryConfig Options

```typescript
{
    maxAttempts: 3,              // Max retry attempts
    baseDelay: 1000,             // Initial delay (ms)
    maxDelay: 30000,             // Max delay cap (ms)
    backoffMultiplier: 2,        // Exponential factor
    jitter: true,                // Add random jitter
    
    // Error patterns to retry
    retryableErrors: [
        'ETIMEDOUT',
        'ECONNREFUSED',
        'timeout',
        'rate limit',
    ],
    
    // Error patterns to NOT retry
    nonRetryableErrors: [
        'PERMISSION_DENIED',
        'INVALID_ARGUMENT',
    ],
}
```

## Retryable Error Detection

The system automatically detects retryable errors:

### Retryable (Default)
- Network timeouts (`ETIMEDOUT`, `ECONNRESET`)
- DNS failures (`ENOTFOUND`, `EAI_AGAIN`)
- Connection refused (`ECONNREFUSED`)
- Rate limiting (`429 Too Many Requests`)
- Service unavailable (`503`)
- "Temporary" error messages

### Non-Retryable (Default)
- Permission denied
- Invalid arguments
- Authentication failures
- NOT_RETRYABLE markers

### Custom Detection

```typescript
// Add custom patterns
const config: RetryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    retryableErrors: [
        ...DEFAULT_RETRY_CONFIG.retryableErrors,
        'my_custom_error',
    ],
};
```

## Circuit Breaker Integration

The retry service works with circuit breakers to prevent retry storms:

```
Attempt 1: Fails → Record failure in circuit breaker
Attempt 2: Check circuit (still closed) → Retry
Attempt 3: Check circuit (now open) → Fail fast, no more retries
```

This prevents hammering a failing service with retries when it's clearly unhealthy.

## Dead Letter Queue

When all retries are exhausted, the operation is added to the DLQ:

```typescript
interface DeadLetterEntry {
    id: string;
    toolName: string;
    error: string;
    attempts: number;
    timestamp: Date;
    correlationId: string;
    missionRunId?: number;
}
```

### DLQ Operations

```typescript
// View queue
const queue = missionRetryService.getDeadLetterQueue({
    toolName: "search_api",
    limit: 20,
});

// Replay entry (requires manual context restoration)
await missionRetryService.replayDeadLetter(
    "dl_123",
    async () => {
        // Restored execution context
        return await callTool();
    }
);

// Remove entry
missionRetryService.removeFromDeadLetter("dl_123");
```

## Events

The retry service publishes events:
- `mission_retry.retry_attempt` - Each retry attempt
- `mission_retry.retry_success` - Successful after retries
- `mission_retry.retry_exhausted` - All retries failed
- `mission_retry.dead_letter_added` - Entry added to DLQ

All events include:
- `toolName`: Affected tool
- `correlationId`: Trace correlation
- `attempts`: Number of attempts
- `timestamp`: Event time

## Integration with Missions

### Tool Call Protection

Modify tool calls to use retry service:

```typescript
// In dynamic-orchestrator.service.ts or tool executor
import { missionRetryService } from "../core/retry.service.js";

async function executeTool(toolName: string, args: any, context: any) {
    const result = await missionRetryService.execute(
        toolName,
        async () => {
            return await actualToolExecution(toolName, args, context);
        },
        {
            maxAttempts: 3,
            baseDelay: 1000,
        },
        {
            missionRunId: context.missionRunId,
            operationId: `${toolName}_${Date.now()}`,
        }
    );
    
    if (!result.success) {
        // Handle final failure
        throw result.error;
    }
    
    return result.result;
}
```

### Best Practices

1. **Set appropriate timeouts** - Match retry delays to operation timeouts
2. **Use idempotent operations** - Retries are safe only for idempotent calls
3. **Monitor DLQ** - Alert on growing dead letter queue
4. **Configure per-tool** - Different tools need different retry policies
5. **Combine with circuit breaker** - Always use together for best results

## Testing

Test file: `server/domain/mission/tests/retry.service.test.ts`

```bash
npm test -- retry.service.test.ts
```

### Manual Testing

```typescript
// Simulate retry scenario
let callCount = 0;

const result = await missionRetryService.execute(
    "test_tool",
    async () => {
        callCount++;
        if (callCount < 3) {
            throw new Error("Simulated failure");
        }
        return "success";
    },
    { maxAttempts: 3, baseDelay: 100 }
);

console.log(`Calls: ${callCount}, Success: ${result.success}`);
// Output: Calls: 3, Success: true
```

## Monitoring

### Key Metrics

- **Retry rate** - % of operations that retry
- **Success after retry** - % of retries that succeed
- **Dead letter rate** - % that end in DLQ
- **Average retry time** - Time spent in retries
- **Active retries** - Currently retrying operations

### Alert Thresholds

- Dead letter queue > 100 entries
- Retry rate > 50% (too many transient failures)
- Circuit breaker open rate > 20%
- Average retry attempts > 2.5

## Troubleshooting

### Too Many Retries
- Check if errors are truly transient
- Adjust retryable error patterns
- Reduce max attempts
- Increase base delay

### No Retries Happening
- Verify errors match retryable patterns
- Check circuit breaker isn't immediately open
- Confirm jitter isn't causing issues

### DLQ Growing
- Root cause: Services genuinely failing
- Action: Fix underlying service issues
- Replay: After fix, replay DLQ entries

## Future Enhancements

- [ ] Persistent DLQ in database (not just memory)
- [ ] Automatic DLQ replay scheduling
- [ ] Adaptive retry policies based on success rates
- [ ] Retry budgets (max retries per time window)
- [ ] Cross-mission retry context sharing
- [ ] Retry analytics dashboard
