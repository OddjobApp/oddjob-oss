# Deep Module Architecture & Routing Guardrails

Oddjob enforces strict architectural boundaries across all API endpoints using the **Deep Module** pattern. This architecture guarantees that HTTP transport routing remains thin, predictable, and decoupled from business logic, domain state transitions, and database interactions.

The architecture is policed by `npm run lint:arch` with a **zero-warning tolerance**.

---

## 1. The Deep Module Philosophy

In software design, a **Deep Module** has a simple interface (thin public surface) that conceals substantial internal complexity (deep functionality).

In Oddjob:
* **Express Route Files (`server/routes/*.ts` or `server/domain/**/api/*.ts`)** are **Surface Modules**. Their only responsibility is parsing request parameters, running Zod schema validation, delegating to domain services, and serializing the HTTP response.
* **Domain Services (`server/domain/**/core/*.service.ts`)** are **Deep Modules**. They encapsulate state machines, database transactions, telemetry generation, and agent orchestrations.

---

## 2. Prohibited Anti-Patterns in Route Handlers

The architectural linter (`scripts/lint-architecture.ts`) flags and blocks the following anti-patterns inside route handlers:

1. **Direct Database Queries in Route Handlers**:
   - ❌ `await db.select().from(missions).where(...)` directly inside `router.get(...)`.
   - ✅ Delegate to `await missionService.getMissionById(id)`.
2. **Inline State Transitions**:
   - ❌ Directly mutating job/cycle state or issuing Drizzle updates in route callbacks.
   - ✅ Delegate to `await cycleOrchestrator.transitionCycle(cycleId, nextState)`.
3. **Unvalidated Request Bodies**:
   - ❌ Using `req.body.someParam` without Zod schema parsing.
   - ✅ `const parsed = createMissionSchema.parse(req.body);`.
4. **Missing W3C Distributed Tracepropagation**:
   - ❌ Executing long-running side-effects without passing trace context.
   - ✅ Pass the request's `traceparent` or generate a span via `generateW3CTraceparent()`.

---

## 3. Canonical Deep Module Implementation Pattern

### The Thin Route Handler
```typescript
// server/routes/example.route.ts
import { Router } from "express";
import { exampleService } from "../domain/example/core/example.service.js";
import { insertExampleSchema } from "@shared/schema/index.js";

const router = Router();

router.post("/action", async (req, res, next) => {
  try {
    const input = insertExampleSchema.parse(req.body);
    const traceparent = (req.headers["traceparent"] as string) || undefined;
    
    const result = await exampleService.executeAction(input, { traceparent });
    
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
```

### The Deep Domain Service
```typescript
// server/domain/example/core/example.service.ts
import { db } from "@server/database_service.js";
import { exampleTable } from "@shared/schema/index.js";
import { generateW3CTraceparent } from "@server/domain/telemetry/w3c-traceparent.js";

export class ExampleService {
  async executeAction(input: any, context?: { traceparent?: string }) {
    const trace = context?.traceparent || generateW3CTraceparent();
    
    // 1. Domain validations
    // 2. State machine transitions
    // 3. PostgreSQL transactional mutations
    // 4. Telemetry audit logging
    return await db.transaction(async (tx) => {
      // Internal business logic
    });
  }
}

export const exampleService = new ExampleService();
```

---

## 4. Verification

Run the architecture gate locally before submitting any PR:

```bash
npm run lint:arch
```
A clean run displays:
```
🔍 [ARCH LINT] Auditing API route handlers for Deep Module enforcement...
✅ [ARCH LINT] Scanned 125 route files.
🎉 [ARCH LINT] All routes follow the Deep Module pattern perfectly!
[ARCH LINT] Warning budget satisfied: 0/0.
```
