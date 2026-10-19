# Research themes applicable to Oddjob

Oddjob already combines **missions**, **App Forge**, **RAG / Knowledge Store**, **GMS (including Evolve)**, **Hermes-style tracing**, **sub-agent delegation**, and **JIT MCP**. The directions below are active research areas that map cleanly onto that stack—useful for roadmap discussions, grants, or R&D spikes—not promises of shipped features.

## Planning and execution

- **Test-time compute and adaptive depth**: Spend extra reasoning or verification only when gates detect uncertainty (complements human approval and refine-before-build flows).
- **Lightweight simulation before act**: Roll out cheap “what-if” trajectories for missions or forge assembly steps before expensive tool or container work.
- **Formal or property-based checks on plans**: Validate auth boundaries, data flow, or pipeline invariants on generated artifacts before execution.

## Memory and learning

- **Continual learning with controlled forgetting**: Evolve distilled skills from traces without overwriting unrelated behavior; pair with human or policy approval.
- **Episodic vs semantic separation**: Hermes-like traces as episodic evidence; RAG and macro skills as semantic layers with explicit promotion rules.
- **Calibrated self-critique**: Models that estimate their own error risk and escalate to smaller specialists or humans.

## Agents and tools

- **Policy learning from traces**: Learn when to prefer MCP tools vs local execution from Hermes-structured outcomes (success, latency, cost).
- **Evidence-grounded multi-agent debate**: Consensus protocols that require citations to retrieved docs or execution logs, aligned with governance patterns.
- **Meta-learning over blueprints**: Discover reusable forge or mission templates from clusters of successful runs.

## RAG and knowledge

- **Graph RAG with time**: Edges and facts tagged with validity intervals so answers respect “what was true when this mission ran.”
- **Adaptive retrieval**: Task-conditioned routing, learned reranking, or verifier models on top of existing chunk pipelines.
- **Structured long-context compression**: Summaries that preserve provenance and tool-relevant facts for downstream agents.

## Safety and alignment

- **Layered constitutional policies**: Compose org forge settings, runtime monitors, and trace-based audits.
- **Automated red teaming**: Systematic adversarial probes against forged UIs and agent outputs, with findings tied to trace IDs.
- **Decision provenance**: Stable links from an action to prompt version, tool inputs, and dataset snapshot identifiers.

## Systems and efficiency

- **Speculative warm paths**: Extend warm-pool ideas with prediction of likely next workloads or knowledge prefetch.
- **Federated or tenant-bound adaptation**: Improve small adapters without centralizing sensitive raw data.

## Further reading

- In-repo overview: [agentic-maturity.md](feature-documentation/agentic-maturity.md)
- Architecture pattern: [architecture_overview.md](architecture_overview.md)
