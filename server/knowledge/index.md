# Oddjob Copilot Knowledge Base

This is the master index for the modular knowledge base. Load relevant documents based on user context.

## Document Structure (24 Total)

```
server/knowledge/
├── index.md                  # This file
├── features/                 # Feature docs (jobs, pipelines, transference-engine, …)
├── architecture/             # 1 system internal doc
│   ├── system-overview.md
│   ├── jobs.md, pipelines.md, schedules.md
│   ├── knowledge-graph.md, alerts.md
│   ├── credentials.md, datasets.md
├── screens/                  # 4 screen docs
│   ├── dashboard.md, job-detail.md
│   ├── pipeline-builder.md, monitoring.md
├── mcp-tools/                # 5 tool docs
│   ├── job-tools.md, pipeline-tools.md
│   ├── schedule-tools.md, knowledge-tools.md
│   ├── utility-tools.md
├── cognitive-states/         # 5 S.C.O.R.E. state docs
│   ├── symptom.md, cause.md, outcome.md
│   ├── resource.md, effect.md
└── relationships/            # 2 interdependency docs
    ├── feature-dependencies.md
    └── data-flows.md
```

## Quick Reference

| Context | Documents Loaded |
|---------|------------------|
| `/jobs/:id` | features/jobs, screens/job-detail, mcp-tools/job-tools |
| `/pipelines/:id` | features/pipelines, screens/pipeline-builder, mcp-tools/pipeline-tools |
| `/schedules` | features/schedules, mcp-tools/schedule-tools |
| `/knowledge/graph` | features/knowledge-graph, mcp-tools/knowledge-tools |
| `/alerts` | features/alerts, screens/monitoring, mcp-tools/utility-tools |
| LLM cost / shadow routing / `oddjob-transference` | features/transference-engine |

**Always loaded**: index.md, relationships/feature-dependencies.md, cognitive-states/{state}.md

## Application Overview

Oddjob is an automation orchestration platform enabling users to:
- Create and manage **Jobs** (reusable task definitions)
- Build **Pipelines** (multi-step workflows)
- Schedule automated execution
- Store and query organizational knowledge
- Monitor system health and troubleshoot issues
