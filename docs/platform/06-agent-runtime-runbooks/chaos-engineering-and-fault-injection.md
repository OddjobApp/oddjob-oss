---
id: chaos-engineering-and-fault-injection
title: Agentic Chaos Engineering, Fault Injection & Resilience Runbook
audience: [HUMAN_PRIMARY, AGENT_PRIMARY, GOVERNANCE]
badge: GOVERNANCE
category: 06-agent-runtime-runbooks
autonomy_level: L2-L4
version: 1.0.0
tags: [chaos, fault-injection, resilience, testing, circuit-breaker, token-starvation, latency, degradation]
summary: Methodologies for executing synthetic chaos experiments against AI agent pipelines, simulating tool outages, poisoned responses, network latency, and token starvation.
verification_status: verified
applies_when:
  - Validating agent self-recovery, error handling, and fallback degradation paths
  - Running automated synthetic chaos experiments in staging or continuous integration
  - Measuring Agent Resilience Scores before promoting new tools or system prompts
do_not_use_when:
  - Running untracked chaos tests directly in production environments without blast radius caps
required_tools:
  - monitoring_trigger_alert
  - run_dependency_audit
  - execute_unit_tests
preconditions:
  - Chaos experiment manifest loaded with explicit blast-radius limits and duration caps
  - Emergency abort kill-switch verified and accessible
approval_requirements:
  - Organization Admin approval required prior to running fault injection against production shadow traffic
success_checks:
  - Agent gracefully detects injected faults, activates fallback pathways, or requests HIL intervention
  - System achieves target Resilience Score ($\ge 90\%$) with zero unhandled fatal process crashes
stop_conditions:
  - Unintended cascade failure affects real user production traffic or budget burn rate > $5/min
escalation:
  - Instantly trigger global chaos kill-switch (`abortChaosExperiment`) to restore normal routing
implementation_evidence:
  - server/domain/chaos/
  - server/domain/testing/
---

# Agentic Chaos Engineering & Fault Injection Runbook `[⚖️ GOVERNANCE]`

> **Audience:** `⚖️ Governance / SRE & Chaos Engineer` &nbsp;|&nbsp; **Classification:** Runtime Operational Runbook

---

## 1. Chaos Engineering Framework Overview `[🧑 Human]`

AI agents operate in unpredictable runtime environments. The Chaos Engine systematically injects controlled perturbations to verify self-healing and graceful degradation:

```mermaid
graph TD
    subgraph ChaosHarness["Chaos Experiment Controller"]
        Generator["Fault Injection Engine"]
        SafetyMonitor["Blast Radius & Budget Kill-Switch"]
    end

    subgraph InjectedVectors["Synthetic Fault Vectors"]
        Lat["1. Latency Jitter (500ms - 5000ms delay)"]
        Fail["2. Tool Failure (HTTP 500 / Timeout)"]
        Drift["3. Schema Drift (Missing keys / Type mutations)"]
        Poison["4. Poisoned Tool Output (Contradictory facts)"]
        Starve["5. Token Starvation (Simulated 429 quota exhaustion)"]
    end

    subgraph AgentPipeline["Target Agent System Under Test"]
        ToolRegistry["MCP Tool Registry"]
        Router["Model & Tool Router"]
        Recovery["Self-Reflection & Recovery Module"]
    end

    Generator --> Lat & Fail & Drift & Poison & Starve
    Lat & Fail & Drift & Poison & Starve --> ToolRegistry
    ToolRegistry --> Router --> Recovery
    Recovery -.->|Resilience Telemetry| SafetyMonitor
```

---

## 2. Standard Chaos Perturbation Vectors `[🤖 Agent Reference]`

| Fault Vector | Injection Mechanism | Expected Agent Behavior | Verification Standard |
| :--- | :--- | :--- | :--- |
| **Tool Outage** | Force target MCP tool to return `HTTP 503 Service Unavailable`. | Agent detects failure, checks tool alternative, or reports degraded status. | Never loops infinitely; fails within $\le 3$ retries. |
| **Poisoned Output** | Return syntactically valid JSON with false/contradictory data. | Critic agent detects anomaly against Knowledge Graph grounding. | Flags evidence mismatch and prompts user. |
| **Network Latency** | Add $3,000\text{ms}$ delay to API response. | Agent respects timeout limits and avoids hanging UI locks. | Emits latency warning span. |
| **Token Starvation** | Simulate API 429 quota error from LLM provider. | Dynamic router falls back to local 8B / Tier 2 fallback model. | Successfully completes task with fallback tier. |

---

## 3. The Agent Resilience Score (ARS) `[🧑 Human]`

At the conclusion of a chaos run, the system calculates the **Agent Resilience Score (ARS)**:

$$\text{ARS} = \left( 0.4 \times \frac{N_{\text{recovered}}}{N_{\text{injected}}} + 0.3 \times \frac{T_{\text{baseline}}}{T_{\text{degraded}}} + 0.3 \times S_{\text{accuracy}} \right) \times 100$$

- **Target Threshold:** Production agent pipelines must maintain $\text{ARS} \ge 85.0\%$.
- **Critical Failure:** Any uncaught fatal exception drops ARS to `0.0%` and blocks deployment.

---

## 4. Emergency Kill-Switch Protocol `[🤖 Agent Reference]`

If an active chaos experiment causes unexpected latency spikes or impacts live workloads:
1. **Immediate Execution**: Call `abortChaosExperiment({ experimentId })`.
2. **State Flush**: Clear all dynamic interceptor middlewares from the MCP Tool Registry.
3. **Audit Log**: Generate post-mortem summary documenting exact fault state and system recovery timing.
