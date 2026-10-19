# App Forge Acceleration Layer: Architectural Documentation

## Overview
The App Forge Acceleration Layer is designed to reduce the latency of the "Assembly" phase and improve the visual fidelity of forged applications. It achieves this by providing the AI Architect with **Packaged Components (HLCs)**—pre-assembled, high-fidelity UI sections that the AI can "edit" rather than build from scratch.

## Key Components

### 1. Packaged Components (HLCs)
Located in `server/domain/core/ui/components/packaged/`, these are production-ready React components that combine multiple Oddjob primitives (Cards, StatCards, Charts, Lucide icons, Framer Motion).
- **IndustrialDashboardHero**: A premium dashboard header with animated charts and live telemetry.
- **MissionControlTable**: A robust mission management table with integrated status badges and actions.

### 2. Source Precaching & Injection
The acceleration layer works by "precaching" the full source code of relevant HLCs and injecting them into the AI context during the Assembly turn.
- **Discovery**: `resolvePackagedFoundations` scans the library for components matching mission keywords.
- **Context Injection**: The full source of the matched components is provided to the AI Architect in the system prompt.
- **Implicit Knowledge**: By seeing the source code, the AI understands how to correctly use the Oddjob primitives and follows the established "Premium WOW" aesthetic.

### 3. Pipeline Integration
- **UIRegistryService**: Dynamically discovers packaged components and adds them to the palette manifest.
- **AppForgeService**: Injects the `@/components/packaged/*` path alias into the forge workspace `tsconfig.json` and ensures the components are copied to the target environment.
- **ForgeCodegenService**: Orchestrates the resolution and injection of foundations.

## Benefits
- **5x Faster Assembly**: AI Turn counts are reduced as the heavy lifting of layout and styling is pre-packaged.
- **God-Tier Fidelity**: Ensures all forged apps adhere to the highest visual standards without requiring iterative designer passes.
- **Lower Error Rate**: Reduces the likelihood of AI-generated syntax or layout errors by providing known-working templates.

## Adding New Patterns
To add a new acceleration pattern:
1. Create a new `.tsx` component in `server/domain/core/ui/components/packaged/`.
2. Ensure it follows the "Premium Glass" aesthetic described in `forge-prompts.ts`.
3. The component will be automatically discovered and made available to the Forge pipeline.
