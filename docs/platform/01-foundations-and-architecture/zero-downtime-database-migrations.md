---
id: zero-downtime-database-migrations
title: Zero-Downtime Database Schema Migration & Rollback Standards
audience: [HUMAN_PRIMARY, HYBRID]
badge: HUMAN_PRIMARY
category: 01-foundations-and-architecture
autonomy_level: L0-L2
version: 1.0.0
tags: [database, migrations, drizzle, schema, postgres, zero-downtime, expand-and-contract, rollback, safety]
summary: Mandatory engineering standard for executing zero-downtime PostgreSQL schema migrations using Drizzle ORM, the Expand-and-Contract design pattern, and automated rollback verification.
verification_status: verified
applies_when:
  - Adding, renaming, or dropping database tables, columns, constraints, or indexes
  - Modifying table schemas shared across live microservices or distributed workers
  - Planning non-blocking asynchronous data backfills
do_not_use_when:
  - Running transient local SQLite test fixtures or non-persistent scratch databases
required_tools:
  - db_generate_migration
  - db_apply_migration
  - code_rollback
preconditions:
  - Target database backup snapshot verified within the last 60 minutes
  - Migration script contains both forward (`up`) and deterministic rollback (`down`) operations
approval_requirements:
  - Any destructive migration (DROP TABLE, DROP COLUMN, TRUNCATE) requires Organization Admin approval
success_checks:
  - Schema changes apply without holding table-exclusive ACCESS EXCLUSIVE locks > 100ms
  - Application continues serving live traffic without HTTP 500 database connection errors
stop_conditions:
  - Migration lock timeout exceeds 5,000ms or replication lag increases by > 10s
escalation:
  - Immediately abort migration and execute corresponding rollback SQL script
implementation_evidence:
  - server/db/schema.ts
  - drizzle/
---

# Zero-Downtime Database Schema Migration & Rollback Standards `[🧑 HUMAN]`

> **Audience:** `🧑 Human / Database Engineer` &nbsp;|&nbsp; **Classification:** Architectural Governance & SDLC Standard

---

## 1. The Expand-and-Contract Migration Pattern `[🧑 Human]`

In a 24/7 high-availability distributed agent environment, database schema changes must NEVER lock tables or break running application instances. All schema modifications MUST follow the 3-phase **Expand and Contract** pattern:

```mermaid
graph TD
    subgraph Phase1["Phase 1: Expand (Non-Breaking)"]
        AddCol["1. Add new nullable column / new table"]
        DualWrite["2. Deploy App V2: Dual-write to Old & New columns"]
    end

    subgraph Phase2["Phase 2: Backfill & Cutover"]
        Backfill["3. Run Async Background Job to backfill old rows"]
        SwitchRead["4. Deploy App V3: Read exclusively from New column"]
    end

    subgraph Phase3["Phase 3: Contract (Cleanup)"]
        DropOld["5. Drop Old Column / Old Table safely"]
    end

    Phase1 --> Phase2 --> Phase3
```

---

## 2. Inviolable Schema Safety Rules `[🤖 Agent Reference]`

1. **Never Rename Columns Directly in SQL:**
   - Renaming `ALTER TABLE users RENAME COLUMN legacy_role TO role;` immediately crashes running application instances reading `legacy_role`.
   - **Instead:** Add `role`, dual-write, backfill, and drop `legacy_role` in a subsequent deployment.
2. **Never Add Columns with `NOT NULL` without a Default:**
   - Adding `ALTER TABLE jobs ADD COLUMN tenant_id UUID NOT NULL;` fails on existing tables with rows.
   - **Instead:** Add `tenant_id UUID DEFAULT '...' NOT NULL;` or add as nullable, backfill, then alter to `NOT NULL`.
3. **Use Concurrent Index Creation:**
   - Never run raw `CREATE INDEX idx_... ON large_table;` in production as it locks writes.
   - **Instead:** Use `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_...;`.
4. **Enforce Strict Statement Timeouts:**
   - Every migration session must execute:
     ```sql
     SET lock_timeout = '3s';
     SET statement_timeout = '30s';
     ```
     If a lock cannot be acquired within 3 seconds, the migration immediately aborts rather than queueing behind long transactions.

---

## 3. Step-by-Step Migration Execution Workflow `[🧑 Human]`

```mermaid
sequenceDiagram
    autonumber
    participant Dev as Engineer / Agent
    participant Drizzle as Drizzle Kit CLI
    participant CI as CI Migration Pipeline
    participant DB as Production Postgres DB
    participant App as Active App Nodes

    Dev->>Drizzle: Update server/db/schema.ts
    Dev->>Drizzle: npm run db:generate
    Drizzle-->>Dev: Generate drizzle/00XX_migration_name.sql
    Dev->>CI: Submit PR with Forward & Rollback SQL
    CI->>CI: Validate non-destructive rules & lock timeouts
    CI->>DB: Apply Migration (Phase 1 Expand)
    Note over DB,App: Zero downtime - App V1 continues operating
    Dev->>App: Deploy App V2 (Dual-Write)
    Dev->>DB: Run Async Backfill Job
    Dev->>App: Deploy App V3 (Read New)
    Dev->>DB: Apply Phase 3 (Contract/Drop Legacy)
```

---

## 4. Rollback Verification Protocol `[🤖 Agent Reference]`

Every migration PR MUST include a tested rollback script that reverses the change without data loss.

| Migration Action | Rollback Procedure | Data Preservation Strategy |
| :--- | :--- | :--- |
| **Added Nullable Column** | `ALTER TABLE tbl DROP COLUMN col;` | Verify new column was not yet relied on for business logic. |
| **Added Index** | `DROP INDEX CONCURRENTLY IF EXISTS idx;` | Instant non-blocking rollback. |
| **Created New Table** | `DROP TABLE IF EXISTS new_table CASCADE;` | Verify foreign keys do not cascade into production tables. |
| **Altered Column Type** | Revert application read layer first; perform reverse migration. | Ensure fallback serializer supports both formats. |
