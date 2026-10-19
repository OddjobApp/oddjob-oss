# UI Module: X-Ray

## Overview

While the primary X-Ray visualization is located in the `mission/ui` module (`SystemExplorerPage.tsx`), the `xray/ui` directory is reserved for any specialized or standalone UI components related to system introspection that do not fit directly into the context of a mission.

This could include global, platform-wide visualizations or diagnostic tools.

## Key Features & Components

- **Platform Topology Viewer:** A potential future component that displays a high-level, interactive map of the entire Oddjob platform, showing the relationships between all major domains and services.
- **Data Lineage Explorer:** A tool to visually trace the flow of data through the system. For example, a user could select a piece of data in a final report and see the entire `pipeline` and `mission` that produced it, all the way back to the source.
- **"What-If" Scenario Simulator:** An advanced tool where an administrator could visually model the impact of a change (e.g., "What happens if I disable this `agent`?") and see the potential downstream effects highlighted in a graph.

## Data Flow

Like other visualization modules, these components would be consumers of data from the `xray/core` domain. They would make API calls to the `xray-analysis.service.ts` and `xray-graph.service.ts` to fetch the complex relational data needed to build the visualizations.
