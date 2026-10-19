# Oddjob Pod Functional Coverage Audit

This document tracks every exported function, class, and method within the 20+ domain pods of the Oddjob platform. Every entry must be verified by a dedicated Vitest unit test.

---

## 🔐 1. Auth Pod (`server/domain/auth`)

### Core Services (`auth/core`)

| File | Function / Export | Test Status | Coverage Note |
| :--- | :--- | :--- | :--- |
| `password-service.ts` | `hashPassword` | 🔴 Untested | Core bcrypt utility |
| `password-service.ts` | `comparePassword` | 🔴 Untested | Core bcrypt utility |
| `jwt.service.ts` | `generateExternalToken` | 🔴 Untested | OAuth / JWT generation |
| `jwt.service.ts` | `validateExternalToken` | 🔴 Untested | OAuth / JWT validation |
| `security.service.ts` | `validatePassword` | 🔴 Untested | Regex-based complexity check |
| `security.service.ts` | `sanitizeInput` | 🔴 Untested | XSS prevention |
| `security.service.ts` | `csrfProtection` | 🔴 Untested | Express middleware |
| `token-service.ts` | `generateToken` | 🔴 Untested | Generic token utility |
| `user-manager.ts` | `createUser` | 🔴 Untested | Drizzle-based insertion |
| `auth-engine.ts` | `authenticate` | 🔴 Untested | Primary login logic |

---

## 🚀 2. Mission Pod (`server/domain/mission`)

### Core Services (`mission/core`)
*(Inventory in Progress)*

---

## 🏗️ 3. Pipeline Pod (`server/domain/pipeline`)

### Core Services (`pipeline/core`)
*(Inventory in Progress)*

---

## 🧠 4. Knowledge Pod (`server/domain/knowledge`)

### Core Services (`knowledge/core`)
*(Inventory in Progress)*

---

## 📦 5. Packaged Builder Pods (`server/domain/core/ui/components/packaged`)

### UI Components & Lifecycle Hooks

| File | Component / Hook | Test Status | Coverage Note |
| :--- | :--- | :--- | :--- |
| `ProjectPlanningPod.tsx` | `ProjectPlanningPod` | 🟢 Tested | Verified via `BuilderPods.test.tsx` & Playwright E2E |
| `DecisionMatrixPod.tsx` | `DecisionMatrixPod` | 🟢 Tested | Verified via `BuilderPods.test.tsx` & Playwright E2E |
| `AgentUpskillingPod.tsx` | `AgentUpskillingPod` | 🟢 Tested | Verified via `BuilderPods.test.tsx` & Playwright E2E |
| `ToolScaffoldPod.tsx` | `ToolScaffoldPod` | 🟢 Tested | Verified via `BuilderPods.test.tsx` & Playwright E2E |
| `registry.ts` | `packagedComponentRegistry` | 🟢 Tested | Verified Packaged Registry Invariant (13 pods) |

---

## 🛠️ Pod Audit Methodology
1. **Cataloging**: Use `grep` and `Get-ChildItem` to identify all `export` keywords.
2. **Unit Creation**: Create `tests/unit/[pod]/[file].test.ts`.
3. **Validation**: Run `npx vitest tests/unit/[pod]`.
4. **Update**: Change status to 🟢 Tested once 100% path coverage is achieved.
