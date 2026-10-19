# Platform Feature Reference

Concise, implementation-grounded docs for major Oddjob subsystems. For UI flows and integration detail, see [feature-documentation](../feature-documentation/README.md). For routes and schemas, see [specs](../specs/README.md).

## Self-improvement & cost optimization

| Feature | Doc | Summary |
| --- | --- | --- |
| **Evolution Engine** | [EVOLUTION_ENGINE.md](./EVOLUTION_ENGINE.md) | HIL skill code improvement from reliability signals (Flight Deck) |
| **Transference Engine** | [TRANSFERENCE_ENGINE.md](./TRANSFERENCE_ENGINE.md) | Shadow-to-active LLM call replacement via local Python handlers (TE-101) |
| **Self-Healing Missions** | [SELF_HEALING_MISSIONS.md](./SELF_HEALING_MISSIONS.md) | Automated mission recovery patterns |

## Mission intelligence

| Feature | Doc |
| --- | --- |
| Multi-Agent Coordination | [MULTI_AGENT_COORDINATION.md](./MULTI_AGENT_COORDINATION.md) |
| Hybrid Human/Agent Orchestration | [HYBRID_HUMAN_AGENT_ORCHESTRATION.md](./HYBRID_HUMAN_AGENT_ORCHESTRATION.md) |
| Mission Dependencies | [MISSION_DEPENDENCIES.md](./MISSION_DEPENDENCIES.md) |
| Mission Correlation | [MISSION_CORRELATION_SYSTEM.md](./MISSION_CORRELATION_SYSTEM.md) |
| Mission Debug Mode | [MISSION_DEBUG_MODE.md](./MISSION_DEBUG_MODE.md) |
| Mission Replay | [MISSION_REPLAY_SYSTEM.md](./MISSION_REPLAY_SYSTEM.md) |
| Predictive Planning | [PREDICTIVE_PLANNING.md](./PREDICTIVE_PLANNING.md) |

## Reliability

| Feature | Doc |
| --- | --- |
| Circuit Breaker | [CIRCUIT_BREAKER_SYSTEM.md](./CIRCUIT_BREAKER_SYSTEM.md) |
| Retry System | [RETRY_SYSTEM.md](./RETRY_SYSTEM.md) |
