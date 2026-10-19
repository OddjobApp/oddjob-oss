
# Adversarial Testing with the "Ghost Runner"

## Overview

The "Ghost Runner" is an advanced, internal Red Team tool built on top of the `seleniumAgentService`. It is designed to simulate sophisticated, automated threats against Oddjob's applications, allowing us to continuously test and harden our defenses.

## Core Capabilities

The Ghost Runner incorporates a suite of evasion techniques to mimic a real attacker.

### 1. Dynamic Identity & Network Obfuscation
To defeat network-level fingerprinting, the agent can mask its origin by routing traffic through residential or mobile proxy networks. It synchronizes a realistic browser fingerprint (User-Agent, screen resolution, etc.) with its proxy, creating a complete and believable identity for each session.

### 2. Advanced Behavioral & AI-Layer Evasion
- **Humanization:** The agent's mouse movements, clicks, and typing all mimic human behavior, including imperfections like typos and reading pauses, to evade behavioral AI detection.
- **Adversarial AI:** The agent can be configured to launch prompt injection attacks against our own AI features, testing their resilience to manipulation.

### 3. Long-Term Stealth & Strategic Evasion
To simulate patient adversaries, the Ghost Runner can operate in a "low and slow" mode. It can save its state to a database and "hibernate" for hours or days between actions, resuming its mission with a new identity to defeat time-based tracking.

## How to Run an Adversarial Test

The Ghost Runner is invoked via the `runAutoPilot` function in the `seleniumAgentService` (or by dispatching a `run_selenium` job). Its advanced capabilities are enabled via the `options` parameter.

### Example Invocation

```typescript
import { jobService } from '@domain/jobs/job.service.js';

// Create a new long-running session
const session = await agentSessionService.createSession("Scrape all public data from the new Project Hub app.");

// Dispatch the first job in the session
await jobService.dispatch({
    type: 'run_selenium',
    name: `Ghost Runner Initial Run: ${session.goal}`,
    payload: {
        startUrl: 'http://localhost:5000/apps/project-hub',
        goal: session.goal,
        options: {
            // Use a residential proxy to mask our IP
            proxyPoolName: 'residential',

            // Enable dynamic evasion to react to threats
            dynamicEvasion: true,

            // Enable prompt injection testing
            adversarialMode: true,

            // Link this run to our long-term session
            sessionId: session.sessionId,

            // After this run, hibernate for 8 hours
            hibernationHours: 8,
        }
    },
    orgId: 1,
});
```

This will trigger a single run of the Ghost Runner. It will perform a few actions, save its progress, and then schedule itself to wake up in 8 hours to continue its mission with a new identity.
