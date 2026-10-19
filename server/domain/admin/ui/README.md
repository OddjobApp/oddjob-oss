# UI Module: Admin

## Overview

The Admin UI module provides the front-end components for system administration and monitoring. It serves as the dashboard for operators to observe the health of the platform, manage system-wide settings, and view critical performance metrics.

This UI is the visual interface for the services exposed by the `admin/core` domain.

## Key Features & Components

- **System Health Dashboard:** A main page that displays the status of crucial infrastructure components, such as the database, job queues (BullMQ), and connections to third-party AI providers.
- **Real-time Metrics:** Visualizations (charts, graphs) for key performance indicators like job throughput, agent activity, and API response times.
- **Configuration Panel:** Forms and controls for managing system-level settings, feature flags, and environment variables.
- **User Management (Admin-level):** Interfaces for administrators to view and manage all users on the platform.

## Data Flow

The components in this module make API calls to the endpoints defined in the `admin` domain's routes. It fetches data from the `admin/core` services to populate the dashboards and sends requests to update configurations or trigger administrative actions.
