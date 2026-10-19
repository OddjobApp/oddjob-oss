# X-Ray Progressive Code Intelligence

**Oddjob X-Ray Level 2** transitions code observability from simple visualization to **Progressive Intelligence**. It empowers architects and AI agents with the tools to navigate, discover, and analyze the structural integrity of complex workspaces and forged applications.

---

## 1. The Core Philosophy

X-Ray Intelligence follows a three-stage lifecycle: **Map → Find → Impact**.

### 🗺️ Stage 1: Map (Intelligence Discovery)
*Start with the big picture, then zoom into the structural skeleton.*
- **Recursive Exploration**: View the entire file tree of any forged app.
- **Structural Skeletons**: Instead of reading full source files, X-Ray extracts the "API" of your code—functions, classes, routes, and interfaces.
- **Focus Windows**: Zoom into specific directories while maintaining the context of the larger project.

### 🔍 Stage 2: Find (Fuzzy Discovery Overlay)
*Locate logic across any boundary instantly.*
- **CMD+K Search**: A global discovery overlay available from any observability view.
- **Fuzzy Matching**: Find symbols by name even with partial or misspelled queries.
- **Structural Identity**: Results are automatically categorized (Function, Route, DB Call, etc.) using deep code analysis, ensuring you find logic, not just text.

### 💥 Stage 3: Impact (Blast Radius Analysis)
*Understand the consequences before the first line of code is changed.*
- **Reverse Reference Mapping**: Locate every component that depends on a specific logic block.
- **Risk Assessment**: See a visual "Blast Radius" in the system graph to understand the architectural risk of a refactor.

---

## 2. Key Features

### Fuzzy Discovery Overlay
Active the overlay with **CMD+K**. It provides a unified search through all missions, tools, and forged applications.
- **Arrow Keys/Enter**: Navigate and select results purely via keyboard.
- **Kind Filtering**: Instantly identify if a symbol is a REST route or a Database operation by its iconography.

### Per-App Intelligence Tabs
Each application in the **App Arsenal** features a dedicated "Intelligence" tab.
- **Scoped Search**: When in an app's tab, CMD+K is automatically filtered to that app's local codebase.
- **Blueprint Graph**: A high-fidelity visualization of the app's internal logic flow.
- **Skeleton Panels**: View the exported interface of any file as a neat, documentation-ready sidebar.

### Implementation Logic QA
During the **App Forge** process, X-Ray Intelligence automatically performs a **Structural QA**. It verifies that generated apps have:
- Valid entry points (routes).
- Correct database interactions.
- Compliant structural patterns.

---

## 3. Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `CMD+K` | Open Discovery Overlay |
| `UP / DOWN` | Navigate results |
| `ENTER` | Go to logic node |
| `ESC` | Close search |
| `P` | Toggle Pipeline View |

---

## 4. Technical Requirements
- **AST-Engine**: Powered by `@ast-grep/napi` for lightning-fast structural parsing.
- **Discovery**: Fuzzy matching optimized via `fuzzysort` for sub-10ms response times.
- **Deployment**: Integrated into the Oddjob Forensic Dashboard.
