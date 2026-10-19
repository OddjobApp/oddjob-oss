# Crew Room Blackboard Protocol

This protocol defines how autonomous agent swarms in Oddjob deliberate, share transient state, and reach consensus using the **Crew Room Blackboard State Machine**.

---

## 1. Blackboard Architecture

The Blackboard acts as a high-speed shared working memory for agents participating in a Crew Room. It prevents duplicate tool invocations and provides complete visibility across concurrent subagents.

```
[Agent A: Researcher]  ──►  ┌─────────────────────────┐  ◄──  [Agent B: Systems Analyst]
                            │   CREW ROOM BLACKBOARD  │
[Agent C: Architect]   ──►  │   - Deliberation Stances│  ◄──  [Agent D: Critic]
                            │   - Artifact Proposals  │
                            │   - Consensus Target    │
                            └─────────────────────────┘
                                         │
                                         ▼
                            [Human Ratification Cockpit]
```

---

## 2. Blackboard Stance Schema

When deliberating over architectural alternatives, candidate models, or execution plans (e.g. rendered in [`DecisionMatrixPod`](../../../server/domain/core/ui/components/packaged/DecisionMatrixPod.tsx)), each agent publishes a typed stance to the blackboard:

```typescript
export interface BlackboardStance {
  /** Unique ID of the deliberating agent */
  agentId: string;
  /** Human-readable name of the agent role */
  agentName: string;
  /** Candidate option preferred by the agent */
  preferredCandidateId: string;
  /** Confidence score between 0 and 100 */
  confidence: number;
  /** Natural language explanation justifying the preference */
  rationale: string;
  /** Timestamp of the vote */
  votedAt: string;
  /** W3C Distributed Traceparent tying this vote to the room session */
  traceparent: string;
}
```

---

## 3. Weighted Deliberation & Consensus Engine

1. **Weight Modifiers**: Multi-criteria scores (e.g., Performance, Cost, Complexity, Reliability) are weighted dynamically ($w_i \in [0.1, 5.0]$).
2. **Consensus Calculation**:
   $$\text{Consensus} = \frac{\sum_{j \in \text{Voters}} \mathbb{I}(c_j = c^*) \cdot \text{confidence}_j}{\sum_{j \in \text{Voters}} \text{confidence}_j} \times 100\%$$
3. **Threshold Enforcement**: The room remains in the `Deliberating` state until the aggregated consensus meets or exceeds `consensusPercentage` (typically $80\%$).
4. **Ratification Hook**: Once consensus is attained, the proposal transitions to the HIL Ratification Cockpit for final human sign-off.
