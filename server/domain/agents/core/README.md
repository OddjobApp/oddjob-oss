
# Agents Core Services

This is the most critical module in the Oddjob platform. It contains the core logic for the creation, orchestration, and advanced capabilities of all AI agents. It can be thought of as the "brain" of the system.

## High-Level Architecture

The module is organized into several key sub-systems:

### 1. Agent Lifecycle & Orchestration
These services are responsible for the fundamental operations of creating, running, and managing agents.

- **`agent-orchestrator.ts`**: The master service that directs the high-level execution of an agentic task.
- **`selenium-agent.service.ts`**: The implementation for the "Ghost Runner" adversarial agent, responsible for all browser-based automation and evasion techniques.
- **`agent-session.service.ts`**: Provides the long-term memory and hibernation capabilities for the "Ghost Runner."

### 2. Advanced Reasoning & Planning
This is a collection of sub-modules that give the agents their advanced cognitive abilities.

- **`meta-cognitive/`**: Implements the "Plan, Execute, Reflect" loop, allowing agents to learn from their mistakes and dynamically adapt their strategy.
- **`speculative/`**: Allows an agent to explore multiple possible futures or implementation paths simultaneously and choose the most promising one.
- **`neuro-symbolic/`**: A hybrid reasoning system that combines the pattern-matching strengths of neural networks with the logical rigor of symbolic AI (rule-based systems).

### 3. Multi-Agent Systems
These modules enable multiple agents to work together on a common goal.

- **`swarm/`**: Provides the infrastructure for agent "swarms," including a shared blackboard for communication and a consensus mechanism for decision-making.
- **`multi-agent/`**: A higher-level abstraction for creating and managing teams of specialist agents.

### 4. Agent Memory
These services provide agents with both short-term and long-term memory.

- **`unified-memory.service.ts`**: A unified interface for accessing various memory stores, including Redis for short-term memory and a vector database for long-term, semantic memory.
- **`institutional-memory.service.ts`**: Allows agents to learn from the successes and failures of other agents across the entire organization.

### 5. Security & Evasion
This sub-system contains the services that power our adversarial testing capabilities.

- **`threat-analysis.service.ts`**: The home of the "Threat Detector" AI, which can sense when an agent is being detected.
