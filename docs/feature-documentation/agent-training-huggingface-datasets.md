# Agent Training Hugging Face Dataset Catalog

This catalog explains the Hugging Face datasets wired into the Agent Performance & Training cycle. The cycle uses them as provenance-tracked benchmark sources, not as blind fine-tuning input.

## Datasets

| Cycle dataset id | Hugging Face repo | Primary use |
| --- | --- | --- |
| `hf_swe_bench_verified` | `princeton-nlp/SWE-bench_Verified` | Coding-agent issue repair, patch planning, and test-based verification. |
| `hf_bfcl` | `gorilla-llm/Berkeley-Function-Calling-Leaderboard` | Function calling, tool relevance, multi-turn calls, long-context tool use, and SQL/tool construction. |
| `hf_toolbench_v1` | `tuandunghcmut/toolbench-v1` | API selection, multi-step tool-use planning, and tool-call conversations. |
| `hf_agentinstruct` | `zai-org/AgentInstruct` | Multi-turn agent trajectories across OS, database, web, knowledge graph, and embodied-task domains. |
| `hf_agent_flan` | `internlm/Agent-FLAN` | Agent-tuning examples and negative samples derived from AgentInstruct and ToolBench. |
| `hf_st_webagentbench` | `ST-WebAgentBench/st-webagentbench` | Web-agent task completion under explicit safety and trustworthiness policies. |
| `hf_trustllm` | `TrustLLM/TrustLLM-dataset` | Truthfulness, safety, fairness, robustness, privacy, and ethics calibration. |
| `hf_tau_usi` | `cmu-lti/tau-usi` | Realistic human-user behavior and simulator-gap checks for multi-turn agents. |
| `hf_mcp_toolbenchpp` | `MCPToolBench/MCPToolBenchPP` | Experimental MCP-style single-step and multi-step tool orchestration. |

## Usage Rules

- Preserve source repo, split, revision, and license notes on every imported row.
- Keep evaluation holdouts separate from generated training pairs.
- Treat gold patches, expected tool calls, and policy outcomes as evaluation criteria unless an operator explicitly approves training use.
- Deduplicate near-identical rows across public benchmarks before scoring improvements.
- Report pass rate by source dataset and slice, not only as a single aggregate score.
- Do not promote a candidate if it improves the average score while regressing on a high-severity safety, privacy, tool-use, or software-repair slice.

## TECHHEAD7 Seeder

Run the curated benchmark seed:

```bash
npx tsx server/scripts/seed-evaluation-datasets-techhead7.ts
```

The script creates the original SDLC eval suites plus Hugging Face-derived benchmark slices in `evaluation_test_sets` and `evaluation_test_cases`. It is idempotent by test-set name: existing matching sets are cleared and recreated.

## Ingestion Notes

The cycle YAML provisions dataset containers with `hf://datasets/...` sources. A later importer can resolve those sources through `datasets.load_dataset(...)` or `huggingface_hub` and write sampled rows into the app or evaluation tables. Until then, the seed script supplies representative, provenance-tagged eval cases that can run through the current LLM-judge evaluation path.
