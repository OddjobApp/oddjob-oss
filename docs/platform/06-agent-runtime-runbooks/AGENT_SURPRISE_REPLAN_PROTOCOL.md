# Agent Surprise & Replanning Protocol

This protocol defines how Oddjob autonomous agents detect execution drift, quantify environmental divergence (the **Surprise Coefficient**), and execute closed-loop replanning without stalling missions.

---

## 1. The Surprise Metric ($S$)

When an agent executes a planned action $A_t$ expecting outcome state $E_t$, it observes actual environment state $O_t$:

$$S = 1 - \text{CosineSimilarity}(\vec{E}_t, \vec{O}_t) + \lambda \cdot \Delta_{\text{schema}}$$

- **Nominal ($S < 0.25$)**: Execution matches expectations. Proceed with next step.
- **Moderate Divergence ($0.25 \le S < 0.60$)**: Minor drift. Execute in-flight parameter adaptation.
- **High Surprise ($S \ge 0.60$)**: Fundamental assumption broken (e.g. target endpoint changed schema, unexpected 404, authorization revoked). Triggers autonomous replan loop.

---

## 2. Autonomous Replan Loop Sequence

```
[Execution Failure / High Surprise Detected]
                     │
                     ▼
[1. Snapshot State & Prune Polluted Context]
                     │
                     ▼
[2. Query Episodic Memory for Compensating Actions]
                     │
                     ▼
[3. Synthesize Alternative Trajectory]
                     │
                     ▼
[4. Schedulability & Constraint Check]
        │                           │
        ▼ (Feasible)                ▼ (Infeasible)
[Execute Compensating Step]   [Escalate to Human-in-the-Loop]
```

---

## 3. Circuit Breakers & Replan Quotas

To prevent runaway agent loops or infinite replanning thrashing:
1. **Max Replans**: An individual mission step allows a maximum of **3 autonomous replans**.
2. **Exponential Backoff**: Successive replans insert dynamic jittered delays to allow downstream rate limits to reset.
3. **Poison Trajectory Quarantine**: If a replan fails twice on the same error signature, the trajectory is quarantined to prevent other agents from using the same strategy.
