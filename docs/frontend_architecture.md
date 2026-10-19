# Oddjob Frontend Architecture Guide

This document provides a detailed technical blueprint of the Oddjob application. It is designed to serve as a reference for developers to maintain, rebuild, or scale the system.

## 1. Technical Stack

| Category | Technology | Purpose |
| :--- | :--- | :--- |
| **Framework** | [React 18](https://react.dev/) | Core UI library |
| **Build Tool** | [Vite](https://vitejs.dev/) | Development server and bundling |
| **Routing** | [Wouter](https://github.com/molefrog/wouter) | Lightweight routing |
| **Data Fetching** | [TanStack Query v5](https://tanstack.com/query/latest) | Server state & caching |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) | Utility-first styling |
| **UI Components** | [Radix UI](https://www.radix-ui.com/) | Accessible primitives |
| **Icons** | [Lucide React](https://lucide.dev/) | Consistent iconography |
| **State Management**| [React Context](https://react.dev/learn/passing-data-deeply-with-context) | Global app state (Auth, Maintenance) |
| **Forms** | [React Hook Form](https://react-hook-form.com/) | Form management & validation |
| **Visualizations** | [ReactFlow](https://reactflow.dev/) | Pipeline diagrams |

---

## 2. Directory Structure (`/client/src`)

The application follows a **Vertical Slice / Module-based** architectural pattern.

*   `main.tsx`: The absolute entry point. Handles bootstrap diagnostics and React root mounting.
*   `App.tsx`: The root React component. Houses Global Providers and the primary Route Switch.
*   **`modules/`**: Contains domain-specific logic. Each module is self-contained.
    *   `/auth`: Login, Registration, Session hooks.
    *   `/dashboard`: High-level overview components.
    *   `/pipelines`: Logic for visual editor and execution.
    *   `/knowledge`: Knowledge Graph (vis-network) and Datasets.
    *   `/missions`: Task orchestration and lifecycle management.
*   **`components/`**:
    *   `/ui`: Low-level Radix-based primitives (buttons, inputs, cards).
    *   `/layout`: Shell components (Sidebar, TopNav, NavWrapper).
*   **`lib/`**: Core infrastructure utilities.
    *   `queryClient.ts`: TanStack Query configuration.
    *   `protected-route.tsx`: Authentication-gate middleware for routes.
*   **`hooks/`**: Shared application-level hooks.
*   **`shared/`**: Common pages (NotFound, ExternalTask) and shared logic.

---

## 3. Bootstrap & Initialization Sequence

Oddjob implements a **Stabilized Bootstrap Layer** to prevent "Blank Screen" hangs.

### `index.html` (Fail-Safe Layer)
-   **Loading Overlay**: A CSS-only overlay centered in the body.
-   **Safety Timeout**: An inline script sets a 5-second timer. If the React app fails to mount, the timeout forcibly removes the overlay.
-   **Manual Bypass**: An emergency **"FORCE CLEAR OVERLAY"** button (at bottom-right) allows manual intervention if security policies block the timeout.
-   **Error Interceptor**: A global `window.onerror` listener catches script load failures (e.g., 401 on JS files) and displays a "LOAD FAILURE" message on the screen.

### `main.tsx` (Diagnostic Entry)
-   **Immediate Clearing**: Tries to clear the parent `index.html` overlay synchronously before any heavy imports.
-   **Dynamic Import Strategy**: Loads `App.tsx` and `index.css` inside `Promise.all`. This prevents parse-time errors from blocking the execution of the fail-safe logic.
-   **Diagnostic Loggers**: Emits `[CORE]` console markers to track the mount lifecycle (Steps 0–8).
-   **Fatal Error Boundary**: Catch blocks around the `root.render()` call display a "Bootstrap Failure" screen with a full stack trace if the core mounting fails.

---

## 4. Providers & Global State

The application context is layered for dependency management:

1.  **`QueryClientProvider`**: Manages all API caching.
2.  **`ThemeProvider`**: Manages dark/light mode persistence (see §6 → *Theming & Semantic Tokens*). Persists the choice under the `oj-ui-theme` localStorage key; defaults to dark, light mode is opt-in via the sidebar / mobile-menu toggle.
3.  **`MaintenanceProvider`**: Checks `/api/maintenance/status` and redirects to a maintenance page if the system is down.
4.  **`AuthProvider`**: Fetches the current user (`/api/user`). 
    *   If 401: Redirects to `/auth/login`.
    *   If 200: Populates `useAuth()` context.
5.  **`OrgProvider`**: Manages the multi-tenant Organization context.
6.  **`Toaster`**: Global notification layer.

---

## 5. Authentication & Security Layer

The application uses a robust session-based authentication system integrated with React Query.

### `AuthProvider` (`@/modules/auth/hooks/use-auth.tsx`)
-   **Identity Fetching**: On mount, the provider calls `GET /api/user`.
-   **Loop Prevention**: If the API returns a `401 Unauthorized`, the provider detects if the user is already on the `/auth` route. If not, it executes a `window.location.replace('/auth/login')`. The `replace` call is critical as it clears the navigation history and prevents React render-loops.
-   **User Object**: The user object is cached in React Query (`['/api/user']`). The context provides `user`, `adminRole`, and `isLoading` states.
-   **Session Bridging**: Login and Logout mutations are handled within the provider to ensure the cache is cleared (`queryClient.clear()`) immediately upon session termination.

### Permission System (`@/lib/permissions.ts`)
-   Oddjob uses a "Can" pattern for granular access control.
-   **Utility**: `can(permission: Permission)` checks the current user's role against the required capability.
-   **Protection**: Used both in the UI (to hide buttons) and in the routing layer.

### Routing Protection (`@/lib/protected-route.tsx`)
-   **`ProtectedRoute`**: A wrapper for Wouter routes.
-   **Behavior**:
    1.  Checks `useAuth()` for `isLoading`.
    2.  If not loading and `!user`, redirects to `/auth/login`.
    3.  If `user` exists, renders the component.
-   **`SuperAdminRoute`**: Extends `ProtectedRoute` by adding a mandatory check for the `isSuperAdmin` flag in the user profile.

---

## 6. UI System & Design Language

The UI is **dark-first** ("Atmospheric") with a fully supported, user-toggleable **light** ("Orbital") mode. Both themes are driven by the same semantic-token system — components never hardcode theme colors.

### Theming & Semantic Tokens

-   **Semantic tokens, not raw colors**: All surfaces and text use Tailwind semantic utilities backed by CSS variables — `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-muted`, `bg-primary`, etc. These are the *only* colors that flip correctly between themes.
-   **Token definitions** live in `client/src/index.css` as HSL custom properties: `:root` holds the **light** palette, `.dark` holds the **dark** palette. `ThemeProvider` toggles the `.dark` class on `<html>`.
-   **Do not** hardcode `bg-white` / `bg-black` / opaque `bg-{slate,zinc,gray}-900` / `text-white` on themed surfaces — `--foreground` inverts between themes, so an opaque literal renders correctly in one theme and wrong in the other. Use the token (`bg-card`, `text-foreground`, …). A single-theme accent that genuinely must differ uses a `light dark:` pair (e.g. `text-emerald-700 dark:text-emerald-200`).
-   **CI gate**: `npm run lint:theme` (script `scripts/check-theme-surfaces.mjs`, also wired into `npm run verify`) fails the build on opaque single-theme surfaces added without a `dark:` counterpart. Genuine exceptions can be marked with a `theme-lint-ignore` comment. Run it before pushing UI changes.

### Core Primitives (`@/components/ui`)
-   **Radix UI**: All complex interactive elements (Dialogs, Popovers, Tabs) are built on top of Radix primitives for accessibility.
-   **Tailwind CSS**: Used for all layout and micro-adjustment styling. 
-   **Standard Components**:
    *   `Button.tsx`: Integrated variants (primary, destructive, outline, ghost).
    *   `Card.tsx`: Standard container for dashboard and list items.
    *   `Switch.tsx`: Used for job and mission state toggles.

### Layout Wrappers (`@/components/layout`)
-   **`NavWrapper.tsx`**: The main application shell. Includes Sidebar and TopNav.
-   **`RouteWrapper.tsx`**: Provides standard padding and breadcrumb support for inner pages.
-   **`Sidebar.tsx`**: Dynamically renders navigation items based on the user's `can(permission)` context.

---

## 7. Domain Modules Overview

Oddjob is organized into domains to keep complexity manageable.

-   **Auth (`@/modules/auth`)**: Handles identity, onboarding, and multi-factor/token flows.
-   **Missions (`@/modules/missions`)**: High-level task orchestration. Tracks lifecycle states from initialization to completion.
-   **Pipelines (`@/modules/pipelines`)**: The visual node-based editor. Integrated with ReactFlow for graph layout and execution telemetry.
-   **Knowledge (`@/modules/knowledge`)**: Advanced graph-data exploration module.
-   **Observability (`@/modules/observability`)**: Aggregates logs, metrics, and forensic traces across the agent network.

## 8. Specialized Module Deep-Dives

### Pipeline Engine (`@/modules/pipelines`)
-   **Visual Editor**: Built on [ReactFlow](https://reactflow.dev/). Each node in the graph represents a task, transformation, or tool call.
-   **Execution Telemetry**: The UI polls `/api/pipelines/executions/:id` using React Query's `refetchInterval` to provide real-time status updates.
-   **Forensics**: A specialized view for tracing exactly where a pipeline failed, including input/output diffs and agent logs.

### Knowledge Engine (`@/modules/knowledge`)
-   **Graph Exploration**: Uses [vis-network](https://visjs.github.io/vis-network/) for dynamic clustering of entities (Agents, Domains, Files).
-   **Query Builder**: A custom UI for generating semantic search queries against the backend vector store.

---

## 9. Development Patterns & Extensibility

To maintain architectural integrity, follow these patterns when adding features:

### Adding a New Module
1.  **Create Directory**: `src/modules/[module-name]`.
2.  **Standard Folders**: `components/`, `hooks/`, `pages/`, `types/`.
3.  **Entry Point**: Create `index.ts` to export all public capabilities.
4.  **Routing**: Add `ProtectedRoute` in `App.tsx`.

### State Management Guidelines
-   **Fetch**: Use `useQuery` / `useMutation`.
-   **Forms**: Use `react-hook-form` + Zod schemas.
-   **Global**: Use Context sparingly only for cross-cutting platform concerns.

---

## 10. Rebuild Checklist (Emergency Recovery)

If the frontend needs to be rebuilt from scratch, follow this order of operations:

1.  **Initialize**: Setup Vite + Tailwind CSS.
2.  **Core Utilities**: Port `src/lib/queryClient.ts` and `src/lib/permissions.ts`.
3.  **UI Components**: Restore the `src/components/ui` Shadcn-based primitives.
4.  **Boot Phase**: Re-implement `index.html` and `main.tsx` fail-safes.
5.  **Module Porting**: Migrate business logic slices one by one.

---
