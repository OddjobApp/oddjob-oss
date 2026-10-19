# Core Services: X-Ray Domain

## Overview

The `xray` domain provides the core services for introspection, analysis, and visualization of the platform's internal workings and the applications it generates. It is a powerful diagnostic and observability tool that allows users to understand the complex relationships between different components, such as agents, pipelines, datasets, and missions.

Its primary purpose is to turn abstract connections into concrete, explorable diagrams and insights.

## Core Responsibilities

- **Dependency Analysis:** Contains services that can traverse the platform's metadata to discover dependencies. For example, it can identify which `missions` are used by a specific `app`, or which `datasets` are consumed by a `pipeline`.
- **Graph Generation:** Provides services to model the discovered dependencies as a graph structure (nodes and edges) that can be easily consumed by frontend visualization libraries.
- **Data Aggregation:** Aggregates data from multiple domains (e.g., `mission`, `apps`, `pipeline`) to build a comprehensive, system-wide view.
- **Visualization Endpoints:** Exposes specialized API endpoints designed to deliver the graph data required by frontend components like the System Explorer and the App Forge's pre-build diagram.

## Key Services

- **`xray-analysis.service.ts`:** The core engine that performs the dependency tracing and analysis across different domains.
- **`xray-graph.service.ts`:** Responsible for taking the analysis output and constructing the formal graph data structure (e.g., in a format compatible with `react-flow`).

## Interactions with Other Domains

- **All Domains:** The `xray` domain is unique in that it has read-only access to the metadata of nearly every other domain. It queries the databases and state stores of domains like `mission`, `pipeline`, `apps`, and `agents` to build its dependency map.
- **`apps`:** Provides the crucial pre-build Logical Architecture Diagram for the App Forge Co-Pilot, allowing users to visualize the proposed application structure before committing to a build.
- **`ui` (Implicit):** Serves as the backend for the System Explorer page and other diagnostic visualizations, providing the data that powers the `react-flow` diagrams.
