# Context Pod

## Purpose
The Context Pod manages the lifecycle and resolution of `PredictionContext` instances. Contexts provide the scoping and permissions for all operations in the prediction domain.

## Key Responsibilities
1.  **Resolution**: Finding or creating the appropriate context based on event signals (tenant, session, workflow, etc.).
2.  **Lifecycle Management**: Creating, updating status (active, idle, closed), and archiving contexts.
3.  **Scope Management**: Linking related contexts (parent/child) and maintaining baselines.

## Interface
The pod implements the `ContextPort` interface:

```typescript
export interface ContextPort {
    resolve(input: ContextResolutionInput, ctx: DomainContext): Promise<ContextResolutionResult>;
    getContext(contextId: string, ctx: DomainContext): Promise<PredictionContext | null>;
    createContext(input: ContextCreationInput, ctx: DomainContext): Promise<PredictionContext>;
    updateLifecycle(input: ContextLifecycleInput, ctx: DomainContext): Promise<PredictionContext>;
    mergeContexts(input: ContextMergeInput, ctx: DomainContext): Promise<PredictionContext>;
    splitContext(input: ContextSplitInput, ctx: DomainContext): Promise<PredictionContext[]>;
    getBaselines(contextId: string, ctx: DomainContext): Promise<string[]>;
}
```

## Usage
```typescript
import { contextService } from "./context.service.js";

const resolution = await contextService.resolve({
    mode: "realtime",
    sessionId: "session-123"
}, domainCtx);

const context = resolution.context;
// Use context.id for scoping quants
```
