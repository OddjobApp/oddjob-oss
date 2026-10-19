# Agent Autonomy & Evolution Engineering Guide

This guide establishes the architectural best practices for authoring, configuring, and governing autonomous AI agents in Oddjob. It covers the **5-Layer Governed AI Control Plane**, the **Evo-Devo Self-Improvement Engine**, and canary verification sandboxing.

---

## 1. The 5-Layer AI Control Plane

Every agent action in Oddjob traverses 5 governance layers to balance autonomy with safety:

```
[Layer 1: User / Mission Intent]
          │
          ▼
[Layer 2: Policy & Permission Gate] (RBAC, Token Quota, Tool Permissions)
          │
          ▼
[Layer 3: Deliberation & Consensus] (Multi-Agent Debate, Weighted Matrices)
          │
          ▼
[Layer 4: Execution & Verification Sandbox] (Canary Benchmarking, SMT Layout Checks)
          │
          ▼
[Layer 5: Forensic Telemetry & W3C Trace] (Immutable Audit Ledger, H3 Geo-Events)
```

---

## 2. Autonomy Levels (L1 – L5)

Oddjob categorizes operations into 5 progressive Autonomy Levels:

| Level | Name | Decision Authority | Human-in-the-Loop (HIL) Gate |
| :--- | :--- | :--- | :--- |
| **L1** | **Assisted** | Agent suggests actions; human must review and manually dispatch every step. | Mandatory for 100% of actions. |
| **L2** | **Supervised** | Agent batches predictable low-risk actions; pauses at phase milestones. | Required at stage transitions. |
| **L3** | **Conditional** | Agent executes within bounded thresholds (e.g. max $50 spend, read-safe queries). | Escalation only if confidence < 80% or threshold breached. |
| **L4** | **High Autonomy** | Autonomous remediation, heuristic self-healing, and automatic trajectory replanning. | Post-action notifications with 15-minute rollback window. |
| **L5** | **Full Autonomy** | Closed-loop mission planning, cross-organization data synthesis, and Evo-Devo tuning. | System-wide audit log only; emergency circuit-breakers active. |

---

## 3. Evo-Devo Self-Improvement Architecture

When an agent encounters trajectory failures or sub-optimal task outcomes, the **Evo-Devo Engine** facilitates competency evolution through three remediation tiers:

### Tier 1: Directive Patch (Prompt Optimization)
- **Fast • Zero Compute Cost**: Automatically synthesizes anti-pattern rules directly into system prompt instructions and parameter validators based on failure stack traces.
- Use when: Tool arguments fail schema validation or the model misinterprets input parameters.

### Tier 2: Golden Samples (Few-Shot Vector Context)
- **Moderate Cost**: Curates verified high-performing execution trajectories into vector embedding space. When similar tasks occur, these golden samples are injected into the agent's prompt context.
- Use when: Multi-step reasoning or complex chain-of-thought workflows require domain-specific demonstrations.

### Tier 3: LoRA Fine-Tuning (Adapter Checkpoints)
- **Compute-Intensive**: Trains a parameter-efficient domain LoRA adapter checkpoint on historical task outcomes.
- Use when: High-volume repetitive domain workflows require deterministic terminology, code generation, or structured JSON output.

---

## 4. Canary Verification Sandbox

Before any evolved competency, prompt patch, or model checkpoint is promoted to production, it must pass the **Canary Benchmark Verification Sandbox**:

1. **Synthetic Test Vectors**: The harness dispatches a suite of 5 diverse synthetic benchmark test cases representing edge cases and previous failure modes.
2. **Canary Pass Score**: The evolved agent must achieve a minimum threshold (typically $\ge 95\%$) before ratification.
3. **Ratification Cockpit**: Human operators review the before/after trajectory comparisons and ratify the competency promotion (as seen in [`AgentUpskillingPod`](../../server/domain/core/ui/components/packaged/AgentUpskillingPod.tsx)).

---

## 5. Pre-Flight Verification

Validate autonomy policies and canonical test cases locally:

```bash
# Verify all 11 canonical autonomy policy rules
npm run smoke:autonomy-policy
```
