# UI Module: Apps

## Overview

The Apps UI module is the user's primary interface for interacting with the App Forge. It contains all the components necessary to create, manage, view, and deploy applications built by the platform.

This module is a sophisticated front end for the powerful app-building services in the `apps/core` domain.

## Key Features & Components

- **App Forge Co-Pilot (`ForgeWizard.tsx`):** The centerpiece of the app creation process. This multi-step wizard guides the user through defining their requirements. Its key steps include:
    1.  **Agile Business Case:** Translating user needs into a formal business case.
    2.  **Asset Discovery:** Identifying relevant platform assets (pipelines, datasets, agents) to fulfill the requirements.
    3.  **Logical Architecture Diagram:** Visualizing the proposed app structure using a `react-flow` diagram (powered by the `xray` domain).
    4.  **Cost & Time Estimation:** Presenting estimates for the build process.
    5.  **Security Pre-Flight Check:** Displaying results from the compliance pre-check.
    6.  **Final Review:** Allowing the user to approve and launch the build.

- **Apps Dashboard:** A page that lists all applications, showing their status (e.g., `building`, `deployed`, `failed`), version, and other key metadata.

- **App Detail Page:** A view that provides detailed information about a specific application, including its build logs, deployed endpoints, and a link to its own UI if applicable.

## Data Flow

The `ForgeWizard.tsx` component is highly interactive, making numerous calls to the backend. It communicates with the `app-forge-copilot.service.ts` to progress through the wizard steps, fetching analysis, diagrams, and estimates. Once the user approves the plan, it sends the final configuration to the `app-forge.service.ts` to initiate the build process. The dashboards and detail pages fetch their data from the `apps` API.
