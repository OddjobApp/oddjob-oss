# UI Module: Evolution

## Overview

The Evolution UI module provides the interface for observing and managing the platform's self-improvement capabilities. It visualizes how the App Forge learns from its past builds and adapts its strategies over time.

This module is the front end for the unique services in the `evolution/core` domain.

## Key Features & Components

- **Evolution Dashboard:** A dashboard that displays key metrics about the platform's learning progress. This could include charts showing the reduction in build errors, improvements in resource efficiency, or the success rate of different Forge Specialist agents.
- **Build Comparison Tool:** An interface that allows users to compare two different builds of the same app side-by-side, highlighting the changes and improvements the `evolution-chamber.service.ts` implemented between versions.
- **Learning Strategy Editor:** A potential future feature where advanced users could fine-tune the learning parameters, such as the weight given to cost-saving versus speed or the mutation rate for experimenting with new build strategies.

## Data Flow

Components in this module are primarily read-only, fetching their data from the `evolution` domain's API. They would visualize the insights and learned heuristics stored by the `evolution-chamber.service.ts` to provide a transparent look into how the system is improving itself.
