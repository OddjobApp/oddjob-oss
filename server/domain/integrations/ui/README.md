# UI Module: Integrations

## Overview

The Integrations UI module provides the user interface for connecting the Oddjob platform to external, third-party services like Jira, GitHub, Slack, or various data sources. It simplifies the process of managing credentials and configuring data flows.

This module contains the front-end components for the `Workflow Builder` and the `Workflows Dashboard`, providing a user-friendly abstraction over the powerful `integrations/core` services.

## Key Features & Components

- **Integration Catalog:** A gallery of available third-party services that the platform can connect to. Each entry has a "Connect" button.
- **OAuth 2.0 Flow:** For integrations like Jira, this module handles the user-facing part of the OAuth flow. It presents the "Connect" button that redirects the user to the third-party service to grant access. It then handles the callback to finalize the connection.
- **Workflow Builder:** A visual interface for creating automated workflows that involve integrated services. Users can drag and drop triggers (e.g., "When a new ticket is created in Jira") and actions (e.g., "Launch an Oddjob mission").
- **Workflows Dashboard:** A dashboard that lists all created workflows, showing their status (active, inactive), their run history, and providing controls to enable, disable, or delete them.
- **Credential Manager:** A secure interface where users can view their connected accounts and revoke access if needed.

## Data Flow

The "Connect" button initiates an API call to the backend (e.g., `server/routes/saas/connectors.ts`) to start the OAuth 2.0 flow. The Workflow Builder UI interacts with backend endpoints to define and save workflow logic. The dashboard fetches its data from the `integrations` API to display the list of workflows and their history.
