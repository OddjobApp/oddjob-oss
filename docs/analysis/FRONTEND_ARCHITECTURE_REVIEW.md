# Frontend Architecture Review: Deep Modules in Pods

**Project:** Oddjob Agentic Agency  
**Review Date:** April 7, 2026  
**Focus:** Feature Pod Organization & Deep Module Patterns

---

## 1. Architecture Overview

The Oddjob frontend follows a **Deep Modules in Pods** architecture, where the application is organized into 20 independent feature modules, each containing a complete set of concerns organized hierarchically.

### **Pod Structure (Feature Modules)**

```
src/modules/
├── admin/                  # System administration and settings
├── agent-ai/              # AI agent interactions
├── agents/                # Multi-agent orchestration
├── analytics/             # Analytics and reporting
├── apps/                  # Application management
├── audit/                 # Audit logging and compliance
├── auth/                  # Authentication & authorization
├── billing/               # Billing/subscription management
├── dashboard/             # Main dashboard and overviews
├── forms/                 # Form builders and templates
├── governance/            # Governance and policy
├── jobs/                  # Job scheduling and execution
├── knowledge/             # Knowledge graph and management
├── missions/              # Mission planning and tracking
├── observability/         # Monitoring, alerts, events
├── pipelines/             # Pipeline creation and execution
├── prospecting/           # Lead generation and prospecting
├── rescue/                # Rescue/recovery operations
└── saas/                  # SaaS platform features
```

---

## 2. Deep Module Structure (Internal Organization)

Each pod follows a standardized deep module structure:

```
modules/[pod]/
├── components/            # React components (UI + Business Logic)
├── hooks/                 # Custom React hooks
├── types/                 # TypeScript type definitions
├── pages/                 # Page-level components
├── constants/             # Module-level constants (optional)
├── index.ts               # Public API barrel export
```

### **Example: Missions Pod**

```
modules/missions/
├── components/
│   ├── MissionsDashboard.tsx
│   ├── MissionChat.tsx
│   ├── MissionTracker.tsx
│   ├── MissionPlanEditor.tsx
│   ├── BlackboardExplorer.tsx
│   ├── DecisionTimeline.tsx
│   └── [23 additional components]
├── hooks/                 # Currently empty
├── types/
│   └── index.ts           # Mission type definitions
├── constants/
│   └── [mission constants]
├── pages/
│   ├── Missions.tsx
│   ├── CreateMission.tsx
│   ├── MissionDetail.tsx
│   └── MissionRunDetail.tsx
└── index.ts               # ~35 line barrel export
```

### **Public API Pattern**

Each module exports through a central `index.ts` barrel file:

```typescript
// Good example from missions/index.ts
export { default as MissionsPage } from "./pages/Missions";
export * from "./types";
export * from "./constants";
export { default as MissionsDashboard } from "./components/MissionsDashboard";
```

---

## 3. Shared Resources Organization

### **Global Utilities & Hooks** (`src/hooks/`)
Shared hooks for cross-module concerns:
- `use-auth.tsx` - Authentication state
- `use-org-context.tsx` - Organization context
- `useApiQuery.ts` - API data fetching
- `useApiMutation.ts` - API mutations
- `useTheme.ts` - Theme management
- `useKnowledgeGraph.ts` - Knowledge graph operations
- `usePipelineSuggestions.ts` - Pipeline intelligence
- And 20+ additional shared hooks

**Pattern:** Hooks are centralized and follow the `usePattern` naming convention.

### **UI Component Library** (`src/components/ui/`)
shadcn-based component system (50+ primitive components):
- Form primitives: `form.tsx`, `input.tsx`, `textarea.tsx`, `checkbox.tsx`
- Layout: `card.tsx`, `sidebar.tsx`, `drawer.tsx`, `sheet.tsx`
- Data: `data-table.tsx`, `table.tsx`, `tabs.tsx`, `pagination.tsx`
- Feedback: `alert.tsx`, `toast.tsx`, `dialog.tsx`, `loading-skeleton.tsx`
- All components follow shadcn conventions and are fully typed

### **Shared Services & Domain Components**

```
src/components/
├── ui/                    # Primitive UI components (shadcn)
├── shared/                # Generic composite components
├── layout/                # Page layout components
├── approvals/             # Approval workflow UI
├── copilot/               # AI copilot integration
├── data/                  # Data visualization
├── governance/            # Governance UI
├── knowledge/             # Knowledge graph UI
├── observability/         # Monitoring UI
└── [others]               # Domain-specific components
```

### **Global Types** (`src/types/`)
- `agent-types.ts` - Agent/AI type definitions
- `form-types.ts` - Form system types
- `dnd.d.ts` - Drag & drop TypeScript definitions

### **Global Utilities** (`src/lib/`)
- `queryClient.ts` - React Query configuration
- `protected-route.tsx` - Route protection logic
- `SuperAdminRoute.tsx` - Admin route protection

---

## 4. Routing Architecture

**Pattern:** Module-first lazy loading with code splitting

```typescript
// From App.tsx - Lazy loading strategy
const Dashboard = lazy(() => 
  import("@/modules/dashboard").then(m => ({ default: m.DashboardPage }))
);

const MissionsPage = lazy(() => 
  import("@/modules/missions").then(m => ({ default: m.MissionsPage }))
);
```

**Benefits:**
- ✅ Each pod loads its own bundle independently
- ✅ Large modules (Knowledge, Pipelines) don't block initial render
- ✅ Code splitting is automatic via webpack/Vite configuration

---

## 5. Dependency Patterns

### **Dependency Direction**

```
auth (foundation)
  ↓
dashboard, jobs, missions (core features)
  ↓
pipelines, knowledge, governance (complex features)
  ↓
admin, analytics, observability (ops features)
```

### **Module Dependencies**

1. **Modules depend on:**
   - Global hooks (`use-org-context`, `useApiQuery`, etc.)
   - Shared UI components (`src/components/ui/*`)
   - Global types and utilities
   - Their own internal modules

2. **Modules DO NOT depend on:**
   - Other feature modules (theoretically isolated)
   - Backend/server logic (API via hooks)

3. **Actual observations:**
   - Some cross-module dependencies may exist (needs audit)
   - Auth module is a foundation dependency
   - Knowledge module feeds multiple other modules

### **API Communication Pattern**

All modules use the same pattern:
- `useApiQuery()` for data fetching
- `useApiMutation()` for mutations
- React Query for caching and synchronization
- Centralized error handling via `useErrorToast()`

---

## 6. Design System Implementation

The frontend implements a **Cinematic Utilitarian** design system (documented in DESIGN.md):

### **Color Palette Integration**
```
Espresso Dark (#2D241E)     → Foreground & primary text
Tan Background (hsl(35, 30%, 96%))  → Neutral canvas
Vibrant Bronze (#CD7F32)    → Accent & active states
Primary Mocha (#4B3D33)     → Headers & major components
```

### **Typography**
- **Primary:** Inter (technical precision)
- **Secondary:** Roboto (data readability)

### **Spatial Design**
- Heavy curvature (`rounded-2xl` = 32px)
- Glassmorphic UI with `backdrop-blur-2xl`
- Multi-layered borders for depth

**Status:** ✅ Well-defined system, **but enforcement varies across modules**

---

## 7. Strengths of Current Architecture

### ✅ **Clear Separation of Concerns**
- Each feature is isolated in its own pod
- Internal organization is predictable and consistent
- Easy to understand the scope of each module

### ✅ **Scalable Module Structure**
- Deep module structure supports 20+ features without chaos
- New features can be added as new pods following the pattern
- Module index.ts acts as a clear public API

### ✅ **Code Splitting & Performance**
- Lazy loading at route level ensures fast initial load
- Each feature loads its own dependencies
- Heavy libraries (vis-network, recharts) only loaded when needed

### ✅ **Shared Utilities Are Centralized**
- UI components in one place
- Hooks follow consistent patterns
- Clear location for new shared utilities

### ✅ **Type Safety**
- TypeScript throughout
- Type definitions organized per-module
- Global type definitions available

---

## 8. Areas for Improvement

### ⚠️ **1. Module Hook Organization**

**Current Issue:** Several modules have empty `hooks/` directories.

```
missions/hooks/          # EMPTY
jobs/hooks/             # Potentially empty
auth/hooks/
├── use-auth.tsx       # Has content
```

**Recommendation:**
- Document why modules can't have their own hooks
- Either populate with module-specific hooks or remove directories
- Consider if hooks should be module-private for complex features

### ⚠️ **2. No Module Dependency Documentation**

**Current Issue:** Unclear which modules depend on which other modules.

**Recommendation:**
```typescript
// Add MODULE.md in each pod documenting:
// ## Dependencies
// - Depends on: auth, shared/hooks
// - Used by: dashboard, observability
// - External: @tanstack/react-query, lucide-react
```

### ⚠️ **3. Inconsistent Component Export Patterns**

**Current:** Barrel exports are comprehensive but very long.

```typescript
// missionsindex.ts - 35 lines of exports
export { default as MissionsPage } from "./pages/Missions";
export { default as CreateMissionPage } from "./pages/CreateMission";
export { MissionChat } from "./components/MissionChat";
// ... many more
```

**Options:**
- Option A: Keep current pattern (explicit is good)
- Option B: Use `export * from "./components"` for auto-export
- Option C: Separate into "pages" and "components" named exports

### ⚠️ **4. No Cross-Module Type Sharing Pattern**

**Current Issue:** Type definitions are module-local, but types may need sharing.

**Question:** How do types from `missions` reach `dashboard`?

**Options:**
- Create `src/types/[domain]` for cross-module types
- Export types through module barrel files
- Use a shared type registry pattern

### ⚠️ **5. Constants Organization**

**Current:** Only some modules have `constants/` directories.

```
missions/constants/     # Has constants
jobs/constants/        # Has constants
auth/constants/        # Possible
```

**Recommendation:** Standardize across all modules or document why selective usage.

### ⚠️ **6. Testing Structure Not Visible**

**Current Issue:** No visible test co-location pattern.

**Options:**
- Adopt `[component].test.tsx` alongside components
- Maintain tests in separate `/tests` directory
- Module-level test suites in `__tests__/`

### ⚠️ **7. Potential Tight Coupling in Admin Module**

The admin module is very large with 20+ pages and complex subdirectories:

```
admin/components/diagnoses/    # Deep nesting
admin/pages/                    # Many pages
```

**Question:** Should admin be split into smaller pods?
- `admin-system`
- `admin-users`
- `admin-observability`

---

## 9. Architectural Concerns & Questions

### 🤔 **Q1: How do modules handle complex cross-module state?**
- Example: Dashboard needs data from missions, jobs, observability
- Current approach: Each hook queries independently?
- Risk: N+1 API queries on dashboard load

**Recommendation:** 
- Implement cross-module state coordination pattern
- Consider query orchestration for composite views
- Document "composite hooks" that coordinate multiple modules

### 🤔 **Q2: How are permissions enforced across modules?**
- Auth module has `use-auth.tsx`
- Each module independently checks permissions?
- Risk: Inconsistent permission enforcement

**Recommendation:**
- Create `useModuleAccess(moduleName)` hook
- Centralize permission logic in auth module
- Document permission scopes per pod

### 🤔 **Q3: Are there undocumented module dependencies?**
- Need to audit actual imports between modules
- Some modules may secretly depend on others
- Risk: Breaking changes when refactoring

**Recommendation:**
- Run code analysis to find module→module imports
- Create dependency graph visualization
- Add pre-commit hook to prevent circular dependencies

### 🤔 **Q4: Knowledge graph dependencies**

Knowledge module appears heavily used by multiple features:
```
useKnowledgeGraph()      # Global hook
useKnowledgeFilters()
useKnowledgeData()
```

**Risk:** Knowledge module becomes a bottleneck or single point of failure

**Question:** Is knowledge truly a feature module or an infrastructure service?

### 🤔 **Q5: Component naming consistency**

**Current patterns observed:**
- `MissionsDashboard.tsx` (compound noun)
- `MissionChat.tsx` (descriptive)
- `LaunchStep.tsx` (feature-specific)

**Issue:** Naming is inconsistent across modules

**Recommendation:** Adopt consistent naming convention:
- Option A: `[Feature][ComponentType].tsx` (e.g., `MissionLauncher.tsx`)
- Option B: Verb-first for actions (e.g., `LaunchMission.tsx`)

---

## 10. Best Practices Implemented Well

### ✅ **Barrel Exports**
Clear public API for each module prevents import chaos.

### ✅ **Lazy Loading at Route Level**
Suspense boundaries with PageLoader component for good UX.

### ✅ **Centralized Error Handling**
`useErrorToast()` for consistent error UX across all modules.

### ✅ **Theme System Integration**
`useTheme()` hook and ThemeProvider show good cross-cutting concern handling.

### ✅ **API Communication Abstraction**
`useApiQuery()` and `useApiMutation()` provide consistent API layer.

---

## 11. Recommended Actions

### Priority 1: High Impact
- [ ] **Audit module dependencies** - Map all module→module imports
- [ ] **Document module purposes** - Add README.md to each module
- [ ] **Standardize hook organization** - Decide on module hook policy
- [ ] **Implement permission model** - Centralized access control

### Priority 2: Medium Impact
- [ ] **Add cross-module type sharing** - Pattern for shared types
- [ ] **Create dependency graph** - Visual documentation
- [ ] **Standardize testing** - Test structure and naming
- [ ] **Document constants** - When/why to use module-level constants

### Priority 3: Nice to Have
- [ ] **Refactor large modules** - Consider splitting admin or knowledge
- [ ] **Component naming guidelines** - Consistent naming convention
- [ ] **Storybook integration** - Component documentation
- [ ] **Module template** - Scaffolding for new modules

---

## 12. Metrics & Health Indicators

### Current State Assessment

| Aspect | Status | Score |
|--------|--------|-------|
| **Module Isolation** | Good - clear boundaries | 8/10 |
| **Code Organization** | Excellent - consistent structure | 9/10 |
| **Scalability** | Good - handles 20 modules | 8/10 |
| **Documentation** | Poor - missing module-level docs | 3/10 |
| **Testing** | Unknown - need audit | ? |
| **Performance** | Good - lazy loading implemented | 8/10 |
| **Type Safety** | Excellent - TypeScript throughout | 9/10 |
| **Design System** | Defined but not enforced | 6/10 |

### Recommended Metrics to Track
- Module bundle size over time
- Import graph density (% cross-module imports)
- Tests per module (coverage %)
- Component reuse metrics (% props from other modules)
- Page load time by module

---

## 13. Summary

The **Oddjob frontend architecture is well-suited for a complex agentic platform** with its deep modules in pods pattern. The organization is clear, scalable, and implements good practices for code splitting and component organization.

### Key Strengths
1. ✅ Clear feature isolation with 20 independent pods
2. ✅ Consistent internal structure across all modules
3. ✅ Good performance with lazy loading
4. ✅ Type-safe throughout
5. ✅ Well-defined UI component library

### Key Gaps
1. ⚠️ Missing module-level documentation
2. ⚠️ Undocumented cross-module dependencies
3. ⚠️ Inconsistent hook organization
4. ⚠️ No visible testing structure
5. ⚠️ Some modules (admin, knowledge) may be too large

### Recommendations
1. **Immediate:** Audit and document module dependencies
2. **Short-term:** Create README.md for each module with purpose, dependencies, and key components
3. **Ongoing:** Implement permission model and prevent unauthorized cross-module imports
4. **Future:** Consider performance monitoring and architectural evolution as the platform grows

---

**Next Steps:**
1. Run dependency analysis tool (see recommendations)
2. Create MODULE.md template and populate for all pods
3. Add pre-commit hooks for architecture validation
4. Schedule quarterly architecture reviews

