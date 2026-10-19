# Circuit Breaker System

## Overview

The Circuit Breaker System prevents cascading failures when external tools fail by automatically detecting issues and temporarily blocking calls to failing tools.

## Purpose

- **Prevent cascading failures** when external services fail
- **Automatic recovery detection** with half-open state
- **Tool-level isolation** - failure in one tool doesn't affect others
- **Fallback support** - automatic fallback to alternative tools
- **Operational visibility** - track which tools are healthy

## Architecture

### Circuit States

```
CLOSED (normal) → [failures threshold] → OPEN (blocking)
    ↑                                      ↓
    └──────── [recovery timeout] ←────────┘
                    ↓
              HALF-OPEN (testing)
```

1. **CLOSED**: Normal operation, calls pass through
2. **OPEN**: Circuit is open, calls are blocked
3. **HALF-OPEN**: Testing if service recovered

### State Transitions

- **Closed → Open**: When failures exceed threshold (default: 5)
- **Open → Half-Open**: After recovery timeout (default: 30s)
- **Half-Open → Closed**: After consecutive successes (default: 2)
- **Half-Open → Open**: Any failure during testing

## MCP Tools

### get_circuit_breaker_status
Check circuit status for all tools or a specific tool.

**Input:**
```json
{
  "toolName": "search"  // Optional - if omitted returns all
}
```

**Output (single tool):**
```json
{
  "success": true,
  "data": {
    "state": "closed",
    "failures": 0,
    "successes": 42,
    "lastFailureTime": null,
    "lastSuccessTime": 1713742800000,
    "totalCalls": 42,
    "consecutiveSuccesses": 5,
    "halfOpenCalls": 0
  }
}
```

**Output (all tools):**
```json
{
  "success": true,
  "data": {
    "summary": {
      "total": 15,
      "closed": 12,
      "open": 2,
      "halfOpen": 1
    },
    "circuits": [
      { "toolName": "search", "state": "closed", "stats": {...} },
      { "toolName": "file_api", "state": "open", "stats": {...} }
    ]
  }
}
```

### reset_circuit_breaker
Manually reset a circuit or all circuits.

**Input:**
```json
{
  "toolName": "file_api"  // Optional - resets all if omitted
}
```

### configure_circuit_breaker
Configure thresholds for a specific tool.

**Input:**
```json
{
  "toolName": "external_api",
  "failureThreshold": 3,
  "recoveryTimeout": 60000,
  "halfOpenMaxCalls": 5,
  "successThreshold": 3
}
```

## Usage

### Basic Circuit Breaker Protection

```typescript
import { circuitBreakerService } from "./circuit-breaker.service.js";

// Execute with circuit breaker protection
const result = await circuitBreakerService.execute(
    "external_api",
    async () => {
        return await callExternalApi();
    }
);
```

### With Fallback

```typescript
const result = await circuitBreakerService.execute(
    "primary_search",
    async () => await primarySearch(query),
    {
        fallback: async () => await backupSearch(query),
        fallbackValue: { results: [], error: "Service unavailable" }
    }
);
```

### Decorator Pattern

```typescript
import { withCircuitBreaker } from "./circuit-breaker.service.js";

class MyToolService {
    @withCircuitBreaker("my_tool", { fallbackValue: null })
    async executeTool(args: any) {
        // Tool implementation
    }
}
```

## Configuration

Default configuration:
```typescript
{
    failureThreshold: 5,      // 5 failures before opening
    recoveryTimeout: 30000,   // 30 seconds before half-open
    halfOpenMaxCalls: 3,        // Max 3 test calls in half-open
    successThreshold: 2         // 2 successes to close
}
```

## Circuit Breaker Error

When a circuit is open:

```typescript
try {
    await circuitBreakerService.execute("failing_tool", fn);
} catch (error) {
    if (error instanceof CircuitBreakerError) {
        console.log(`Circuit ${error.state} for ${error.toolName}`);
        // Handle blocked call
    }
}
```

## Events

Circuit breaker publishes events:
- `circuit_breaker.circuit_opened`
- `circuit_breaker.circuit_closed`
- `circuit_breaker.circuit_half_opened`
- `circuit_breaker.call_rejected`

All events include:
- `toolName`: Affected tool
- `correlationId`: Trace correlation
- `timestamp`: Event time
- `details`: Additional context

## Integration with Missions

### Protecting Tool Calls

Modify the dynamic orchestrator to use circuit breaker:

```typescript
// In dynamic-orchestrator.service.ts
case "CALL_TOOL":
    const toolName = decision.action_details?.tool_name;
    
    // Check circuit breaker
    const check = circuitBreakerService.canExecute(toolName);
    if (!check.allowed) {
        // Handle blocked call - try fallback or skip
        logger.warn(`Circuit open for ${toolName}`);
        break;
    }
    
    try {
        const result = await handleToolCall(toolName, args, context);
        circuitBreakerService.recordSuccess(toolName);
    } catch (error) {
        circuitBreakerService.recordFailure(toolName, error);
        throw error;
    }
```

## Testing

Test file: `server/domain/mission/tests/circuit-breaker.service.test.ts`

```bash
npm test -- circuit-breaker.service.test.ts
```

### Manual Testing

```typescript
// Simulate failures
for (let i = 0; i < 5; i++) {
    circuitBreakerService.recordFailure("test_tool", new Error("Simulated"));
}

// Circuit should be open
const check = circuitBreakerService.canExecute("test_tool");
console.log(check.allowed); // false

// Wait for recovery timeout, then test
// ...

// Check status
const status = circuitBreakerService.getStats("test_tool");
console.log(status?.state);
```

## Monitoring

### Dashboard Metrics

Track these metrics:
- **Open circuits count**: High count indicates systemic issues
- **State transitions**: Frequent transitions suggest instability
- **Failure rates per tool**: Identify problematic tools
- **Recovery times**: Measure auto-recovery effectiveness

### Alerts

Set up alerts for:
- Circuit opens (immediate notification)
- Multiple circuits open simultaneously
- High failure rates (> 50% for any tool)
- Circuits stuck open for > 5 minutes

## Best Practices

1. **Per-tool circuits**: Each tool gets its own circuit
2. **Appropriate thresholds**: Match thresholds to tool characteristics
3. **Fast external services**: Lower thresholds (2-3 failures)
4. **Slow/heavy operations**: Higher thresholds (10+ failures)
5. **Always have fallbacks**: Provide alternative paths
6. **Monitor and alert**: Track circuit health

## Troubleshooting

### Circuit keeps opening
- Check tool health
- Verify network connectivity
- Review timeout settings
- Check for rate limiting

### Circuit won't close
- Verify service recovery
- Check success criteria
- Review half-open limits
- Manual reset if needed

### False positives
- Adjust failure threshold
- Check error classification
- Distinguish transient vs permanent errors

## Future Enhancements

- [ ] Adaptive thresholds based on historical performance
- [ ] ML-based anomaly detection for failure patterns
- [ ] Automatic fallback chain (A → B → C)
- [ ] Circuit breaker metrics in Prometheus format
- [ ] UI dashboard for real-time circuit visualization
