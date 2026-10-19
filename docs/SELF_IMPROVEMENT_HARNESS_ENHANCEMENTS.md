# Proposal: Enhancing the Self-Improving Harness

## 1. Executive Summary

The Oddjob platform contains a sophisticated, automated system for self-improvement that is far more advanced than a simple testing harness. It uses an Observe-Orient-Decide-Act (OODA) loop to monitor, analyze, and evolve its own operational blueprints (`cycle.yaml` files). However, a detailed review has identified several critical gaps that limit its true self-improvement potential.

This document outlines a two-phase plan to address these gaps and transform the self-improving harness into a truly robust and intelligent capability. Phase 1 will focus on foundational fixes to address high-severity gaps in simulation fidelity and code-level modification. Phase 2 will focus on enhancing the system's usability and intelligence by building a user-facing Harness Registry and improving metrics and observability.

## 2. Current State Analysis

The current system is built on a set of powerful core concepts:

*   **Cycles as Harnesses**: The system treats `cycle.yaml` files as "harnesses" or blueprints for complex, multi-step automated workflows.
*   **The Orchestrator Loop**: A meta-cycle, `self-harness-orchestrator`, manages the improvement loop for other cycles.
*   **E2E Validation**: The system is tested with Playwright end-to-end tests that simulate a full improvement loop.
*   **Human-in-the-Loop**: All changes require human approval before being applied to the codebase.
*   **Domain-Specific Logic**: The system uses a pluggable architecture to handle different types of harnesses (e.g., `incident-response`, `software-audit`).
*   **The "Executor" Pattern**: Actions defined in the `cycle.yaml` files are mapped to `JobExecutor` classes that contain the business logic for that action.

## 3. Identified Gaps

Our analysis has identified four key gaps that limit the effectiveness of the self-improving harness:

1.  **Code-Level Blindspot (High Severity)**: The system cannot modify its own executor code, only the YAML definitions that orchestrate it. This is the most critical gap, as it prevents the system from fixing fundamental flaws in its own logic.
2.  **Simulation Fidelity (High Severity)**: The validation process is based on a random number generator, not a true simulation. This undermines the entire improvement loop, as "validated" changes may not be effective in the real world.
3.  **Harness Discovery (Medium Severity)**: The backend services for a harness registry exist, but there is no UI for operators to easily discover, manage, or visualize the harnesses and their versions.
4.  **Metrics & Observability (Medium Severity)**: While basic pass/fail metrics are collected, the system would benefit from more granular performance and resource metrics to make more intelligent improvement decisions.

## 4. Proposed Enhancements

To address these gaps, we propose a two-phase plan:

### Phase 1: Foundational Fixes (High-Severity Gaps)

*   **Implement a True Simulation Engine**: Replace the placeholder `IncidentSimulatorService` with a real simulation engine. This will involve:
    *   Integrating with a chaos engineering framework (e.g., Chaos Toolkit) or building a more sophisticated in-house solution.
    *   Creating a dedicated test environment where simulations can be run without impacting production systems.
    *   Developing a set of realistic incident and audit scenarios to test against.

*   **Introduce Code-Level Modification**: Design and implement a new capability that allows the system to propose and apply changes to the TypeScript code of the executors themselves. This will involve:
    *   A new set of AI prompts and tools for generating and validating TypeScript code.
    *   A sandboxed environment for safely testing code-level changes.
    *   Strict validation and human approval gates for all code modifications.

### Phase 2: Usability and Intelligence (Medium-Severity Gaps)

*   **Build a Harness Registry UI**: Create a new section in the `client` application that provides a user-friendly interface for managing the harness registry. This will allow operators to:
    *   View a list of all available harnesses and their versions.
    *   See the history of changes for each harness.
    *   Activate or deactivate specific harness versions.

*   **Enhance Metrics and Observability**: Integrate more detailed performance and resource monitoring into the evaluation process. This will involve:
    *   Tracking resource consumption (CPU, memory) and cost per execution.
    *   Implementing more granular performance timings for each step in a harness.
    *   Creating a new dashboard for visualizing these metrics and identifying performance bottlenecks.

## 5. Roadmap and Next Steps

This proposal represents a significant investment in the Oddjob platform's self-improvement capabilities. The next step is to review and refine this plan, and then to begin the implementation of Phase 1.

We recommend starting with the implementation of a true simulation engine, as this will provide the most immediate and significant improvement to the self-improving harness. Once the simulation engine is in place, we can then move on to the more complex challenge of code-level modification.
