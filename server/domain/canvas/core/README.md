# Core Service: Canvas

## Overview

The `canvas` domain is the public-facing entry point for the App Canvas UI generation system. Its primary responsibility is to orchestrate the process of creating a data-bound React user interface for a newly forged application.

It acts as the bridge between the App Forge and the specialized services that perform the actual code generation.

## Core Responsibilities

- **Orchestration:** Exposes the main `generateAppCanvas` method, which serves as the single entry point for the App Forge to request a UI.
- **Service Integration:** Coordinates the invocation of the `UiGenerationService`, passing it the necessary context like the application's OpenAPI specification and organization ID.
- **Future Expansion:** Designed to be the place where future UI-related enhancements (e.g., file writing, project scaffolding, theming) would be managed.

## Key Services

- **`canvas.service.ts`:** The main public service for the domain.

## Interactions with Other Domains

- **`apps`:** The `app-forge.service.ts` is the sole consumer of this domain. It calls `CanvasService.generateAppCanvas` after a backend has been successfully built.
- **`canvas/services`:** It delegates the complex task of AI-driven code generation to the `UiGenerationService`.
