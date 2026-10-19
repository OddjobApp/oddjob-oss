# Phase 5 Batch 1: Diagnostics & Audit

## Goal
Migrate error handling, cause analysis, and auditing services to centralized domains to reduce the footprint of the legacy `server/services/` directory and align with the POD architecture.

## Status: IN_PROGRESS

### Domain: `diagnostics` (Established)
This domain handles error clustering, diagnosis, and automated alerting.

- [x] `server/domain/diagnostics/` (Canonical POD structure)
- [x] `server/domain/diagnostics/index.ts` (Entry point)
- [x] `server/domain/diagnostics/core/error-alert.service.ts` (Migrated from admin/core)
- [x] `server/domain/diagnostics/core/error-clustering.service.ts` (Migrated from admin/core)
- [x] `server/domain/diagnostics/core/error-diagnosis.engine.ts` (Migrated and Renamed from admin/core)
- [x] Global Import Reconciliation (Points to `@domain/diagnostics/index.js`)
- [ ] NOTE: Forensic and Root-Cause logic is intentionally distributed across `trace-logger.service.ts`, `sentinel-service.ts`, and `rescue-service.ts`.

### Domain: `audit` (Completed)
Migrate auditing and compliance services.

- [x] `server/domain/audit/`
- [x] [MOVE] `server/domain/admin/core/audit.service.ts` -> `server/domain/audit/core/audit-service.ts`
- [x] [MOVE] `server/services/transaction-log.ts` -> `server/domain/audit/core/transaction-log.ts`

### Domain: `core` (Refinement - Completed)
Services that are essentially system-wide or infrastructure.

- [x] `server/domain/core/retry-service.ts`
- [x] `server/domain/core/cache-service.ts`
- [x] `server/domain/core/lock-service.ts`

## Verification Plan

### Automated Tests
- [ ] `npx tsc --noEmit` to verify type safety.
- [ ] `npm run check` to verify import integrity.
- [ ] `npx vitest tests/integration/` to ensure no regression in service accessibility.

