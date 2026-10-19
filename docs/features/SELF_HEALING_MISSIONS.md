# Self-Healing Missions

## Overview

The Self-Healing Missions Service automatically recovers from common failures by recognizing failure patterns and applying known remedies. It escalates novel failures to humans for resolution and learns from recovery actions.

## Purpose

- **Automatic recovery** - Fix common failures without human intervention
- **Pattern recognition** - Identify known failure signatures
- **Smart escalation** - Only escalate truly novel failures
- **Continuous learning** - Improve from human resolutions
- **Reduced downtime** - Faster recovery from transient failures

## Architecture

### Healing Flow

```
Tool Failure
    ↓
Match Pattern? → Yes → Auto-remediate? → Yes → Apply Remedy
    ↓                    ↓
    No                   No
    ↓                    ↓
Novel Failure ← Escalate ← Auto-remediation Failed
    ↓
Human Intervention
    ↓
Resolution Applied
    ↓
Learn Pattern? → Yes → Add to Database
```

### Failure Pattern Matching

Patterns are matched using:
- Error message regex patterns
- Error codes
- Stack trace signatures
- Tool name context

## Known Failure Patterns

### 1. Request Timeout (pattern_timeout)
- **Matches**: `timeout`, `ETIMEDOUT`, `deadline exceeded`
- **Severity**: Medium
- **Auto-remediate**: Yes
- **Remedies**:
  - Retry with exponential backoff (75% success)
  - Increase timeout (60% success)

### 2. Rate Limit Exceeded (pattern_rate_limit)
- **Matches**: `rate limit`, `429`, `throttle`, `quota exceeded`
- **Severity**: Medium
- **Auto-remediate**: Yes
- **Remedies**:
  - Wait and retry (90% success)
  - Reset circuit breaker (40% success)

### 3. Authentication Failure (pattern_auth_failure)
- **Matches**: `unauthorized`, `401`, `403`, `credentials`
- **Severity**: High
- **Auto-remediate**: No
- **Action**: Immediate escalation to human

### 4. Connection Refused (pattern_connection_refused)
- **Matches**: `ECONNREFUSED`, `ENOTFOUND`, `unreachable`
- **Severity**: High
- **Auto-remediate**: Yes
- **Remedies**:
  - Retry with backoff (65% success)
  - Use alternative service (80% success)

### 5. Resource Exhausted (pattern_resource_exhausted)
- **Matches**: `out of memory`, `disk full`, `ENOSPC`
- **Severity**: Critical
- **Auto-remediate**: No
- **Action**: Escalate for infrastructure scaling

## MCP Tools

### get_self_healing_stats
Get healing service statistics.

**Output:**
```json
{
  "success": true,
  "data": {
    "totalAttempts": 150,
    "resolved": 98,
    "escalated": 42,
    "failed": 5,
    "inProgress": 5,
    "byPattern": {
      "pattern_timeout": {
        "detected": 45,
        "autoResolved": 34,
        "escalated": 11,
        "successRate": 0.76
      }
    },
    "pendingEscalations": 3
  }
}
```

### get_failure_patterns
Get all known failure patterns.

**Output:**
```json
{
  "success": true,
  "data": {
    "patterns": [
      {
        "id": "pattern_timeout",
        "name": "Request Timeout",
        "description": "Tool call exceeded timeout limit",
        "severity": "medium",
        "autoRemediate": true,
        "remedies": [
          {
            "id": "remedy_retry_with_backoff",
            "name": "Retry with Exponential Backoff",
            "successRate": 0.75,
            "estimatedTime": 10
          }
        ],
        "metadata": {
          "detectedCount": 45,
          "autoResolvedCount": 34,
          "escalationCount": 11
        }
      }
    ],
    "total": 5,
    "autoRemediable": 3
  }
}
```

### get_active_escalations
Get escalations awaiting human intervention.

**Input:**
```json
{
  "status": "pending"
}
```

**Output:**
```json
{
  "success": true,
  "data": {
    "escalations": [
      {
        "id": "esc_1713742800000_abc123",
        "healingAttemptId": "heal_1713742800000_def456",
        "reason": "Unknown failure pattern - no auto-remediation available",
        "urgency": "high",
        "failureContext": {
          "missionRunId": 123,
          "toolName": "external_api",
          "error": { "message": "Custom error not in database" },
          "remediesAttempted": []
        },
        "status": "pending",
        "createdAt": "2024-04-21T10:30:00Z"
      }
    ],
    "total": 3,
    "pending": 2
  }
}
```

### acknowledge_escalation
Acknowledge an escalation (human taking action).

**Input:**
```json
{
  "escalationId": "esc_1713742800000_abc123",
  "response": "Looking into authentication issue"
}
```

### resolve_escalation
Resolve an escalation with the fix applied.

**Input:**
```json
{
  "escalationId": "esc_1713742800000_abc123",
  "resolution": "Refreshed API credentials - token had expired",
  "learnPattern": true
}
```

## Usage

### Automatic Healing

```typescript
import { selfHealingService } from "./self-healing.service.js";

async function handleToolFailure(missionRunId: number, toolName: string, error: Error) {
    // Attempt automatic healing
    const healingAttempt = await selfHealingService.attemptHealing(
        missionRunId,
        toolName,
        error,
        { contextData: 'optional' }
    );

    if (healingAttempt.finalStatus === 'resolved') {
        console.log('✅ Auto-healed successfully!');
        console.log('Remedies applied:', healingAttempt.remediesAttempted);
        return { recovered: true };
    }

    if (healingAttempt.finalStatus === 'escalated') {
        console.log('⚠️ Escalated to human operators');
        console.log('Escalation ID:', healingAttempt.escalationId);
        return { recovered: false, escalationId: healingAttempt.escalationId };
    }
}
```

### Manual Escalation Management

```typescript
// Get pending escalations
const pending = selfHealingService.getEscalations('pending');

// Acknowledge (human is working on it)
selfHealingService.acknowledgeEscalation(
    escalationId,
    "Investigating authentication failure"
);

// Resolve with fix
selfHealingService.resolveEscalation(
    escalationId,
    "Refreshed API credentials",
    true  // Learn from this for future
);
```

### Adding Custom Failure Patterns

```typescript
const newPattern = selfHealingService.addPattern({
    name: "Custom API Error",
    description: "Specific error from our custom API",
    signature: {
        errorMessagePatterns: ['custom_api_error', 'E_CUSTOM'],
        errorCodes: ['E_CUSTOM'],
        toolName: "custom_api"
    },
    severity: 'medium',
    autoRemediate: true,
    remedies: [
        {
            id: "remedy_custom",
            name: "Custom Fix",
            description: "Apply custom recovery logic",
            action: { type: 'retry', config: { delay: 1000, maxAttempts: 2 } },
            successRate: 0.8,
            maxAttempts: 2,
            estimatedTime: 5
        }
    ]
});
```

## Integration with Mission Runner

Add to your mission run error handler:

```typescript
// In mission-run.service.ts
async function onToolError(toolName: string, error: Error) {
    // Try self-healing first
    const healing = await selfHealingService.attemptHealing(
        this.missionRunId,
        toolName,
        error
    );

    if (healing.finalStatus === 'resolved') {
        // Retry the tool call
        return await this.retryTool(toolName);
    }

    if (healing.finalStatus === 'escalated') {
        // Pause mission and wait for human
        await this.pauseMission(
            `Awaiting human intervention: ${healing.escalationId}`
        );
    }

    // Otherwise, propagate error
    throw error;
}
```

## Remedy Actions

### Available Remedy Types

1. **retry** - Retry with delay
2. **reset_circuit_breaker** - Reset circuit for tool
3. **clear_cache** - Clear relevant cache
4. **restart_service** - Restart a service
5. **adjust_timeout** - Increase timeout
6. **skip_tool** - Skip with fallback value
7. **use_alternative_tool** - Switch to backup tool
8. **modify_params** - Change parameters
9. **escalate** - Request human intervention

### Creating Custom Remedies

```typescript
const customRemedy: Remedy = {
    id: "remedy_custom",
    name: "Custom Recovery",
    description: "My custom fix",
    action: {
        type: 'modify_params',
        toolName: 'api_call',
        paramChanges: { timeout: 30000 }
    },
    successRate: 0.85,
    maxAttempts: 2,
    estimatedTime: 3
};
```

## Learning from Humans

When humans resolve escalations, the system can learn:

```typescript
// When resolving, enable learning
selfHealingService.resolveEscalation(
    escalationId,
    "Fixed by increasing timeout",
    true  // Learn this fix
);

// This triggers:
// 1. Pattern analysis
// 2. Remedy extraction
// 3. New pattern proposal
// 4. Confidence calculation
```

## Statistics & Monitoring

### Key Metrics

- **Auto-resolution rate**: % healed without human
- **Escalation rate**: % requiring humans
- **Average resolution time**: Time to heal
- **Pattern effectiveness**: Success per pattern
- **Learning rate**: New patterns discovered

### Health Check

```typescript
const stats = selfHealingService.getStats();

// Alert if escalation rate is high
if (stats.escalated / stats.totalAttempts > 0.5) {
    alert('High escalation rate - many novel failures');
}

// Alert if pending escalations pile up
if (stats.pendingEscalations > 10) {
    alert('Escalation backlog - need more operators');
}
```

## Testing

Test file: `server/domain/mission/tests/self-healing.service.test.ts`

```bash
npm test -- self-healing.service.test.ts
```

### Manual Testing

```typescript
// Test pattern matching
const pattern = selfHealingService.matchFailurePattern(
    new Error("Request timeout exceeded")
);
console.log(pattern?.name); // "Request Timeout"

// Test healing flow
const healing = await selfHealingService.attemptHealing(
    123,
    "api_call",
    new Error("ETIMEDOUT")
);
console.log(healing.finalStatus); // "resolved" or "escalated"
```

## Best Practices

1. **Start with patterns** - Define patterns for your common failures
2. **Monitor false positives** - Watch for over-eager healing
3. **Track effectiveness** - Measure which remedies actually work
4. **Gradual rollout** - Start with safe remedies (retry, timeout)
5. **Human feedback loop** - Always learn from human resolutions
6. **Escalation paths** - Clear paths for different severity levels

## Troubleshooting

### Healing not working
- Check pattern matching is correct
- Verify remedy actions are properly implemented
- Check event stream is receiving events

### Too many escalations
- Add more patterns for your common failures
- Lower autoRemediate threshold
- Review and improve remedy success rates

### False positives
- Tighten pattern signatures
- Add more specific error codes
- Use stack trace patterns for accuracy

## Future Enhancements

- [ ] ML-based pattern discovery
- [ ] Automatic remedy effectiveness scoring
- [ ] Predictive healing (heal before failure)
- [ ] Cross-mission learning
- [ ] Anomaly detection for novel failures
- [ ] Integration with incident management
- [ ] Remedy A/B testing
