# UI Module: Agents

## Overview

The Agents UI module provides the user interface for interacting with and managing the AI agents on the platform. It allows users to view available agents, inspect their capabilities, monitor their current activities, and review their operational history.

This module is the primary window into the "workforce" of the platform, making the `agents/core` services accessible and understandable.

## Key Features & Components

- **Agent Registry Page:** A gallery or list of all available agent personas (e.g., "Business Analyst," "Ghost Runner," "Forge Supervisor"). It displays their descriptions, capabilities, and statuses.
- **Agent Detail Page:** A comprehensive view of a single agent, including its detailed configuration, recent logs, current mission assignments, and historical performance data.
- **Agent Monitoring:** Real-time components that may show what a specific agent is currently "thinking" or doing, streaming its operational logs.
- **Selenium "Ghost Runner" Dashboard:** A specialized dashboard for the adversarial Selenium agent, providing controls for launching scraping missions and displaying the results and captured data. It also includes UI for managing its identity (proxies, fingerprints) and viewing threat analysis reports.

## Data Flow

UI components fetch data from the `agents` API endpoints to list agents and their details. They interact with `agent-persona.service.ts` to get definitions and with other services to retrieve live status and logs. Actions taken in the UI, like launching a Ghost Runner mission, trigger the corresponding backend services in the `agents/core` domain.
