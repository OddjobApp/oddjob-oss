
# App Forge Core Services

This module contains the collection of highly specialized services that are orchestrated by the `AppForgeService` to build an application. If the App Forge is the factory, these services are the individual robotic arms and assembly line stations, each with a very specific job.

## Key Specialist Services

- **`app-copilot.service.ts`**: The backend service that powers the **App Forge Co-Pilot**. It orchestrates the various AI agents (Business Analyst, Forecaster, etc.) that guide the user through the requirements and planning process.

- **`forge-plan.service.ts`**: Takes the final, approved business case from the Co-Pilot and creates a detailed, step-by-step technical execution plan for the build.

- **`forge-codegen.service.ts`**: The primary code generation service. It takes a specific task from the execution plan (e.g., "Create a React component for the dashboard") and invokes an AI model to write the code.

- **`forge-dependency.service.ts`**: Manages the application's dependencies, ensuring that the correct libraries are installed and that the `package.json` file is kept up to date.

- **`forge-self-heal.service.ts`**: An automated testing and debugging service. After code is generated, this service can run tests, and if they fail, it can attempt to automatically fix the errors.

- **`forge-refine.service.ts`**: Used in later waves of a multi-wave build to analyze existing code and make improvements or add new features based on feedback from the `ForgeSupervisor`.

- **`app-versioning.service.ts`**: Manages the versioning of the created applications, allowing for rollbacks and a clear history of changes.
