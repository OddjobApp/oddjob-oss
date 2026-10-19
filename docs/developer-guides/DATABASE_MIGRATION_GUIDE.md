# Database Schema & Zero-Downtime Migration Guide

Oddjob manages 480 PostgreSQL tables using [Drizzle ORM](https://orm.drizzle.team). To prevent data loss, connection lock stalls, and downtime, all database modifications must satisfy the two platform integrity gates:

1. **Schema Drift Detection**: `npm run check:schema-drift` (verifies zero drift between code definitions and physical database catalogs).
2. **Migration Journal Check**: `npm run check:migration-journal` (verifies sequence integrity in the Drizzle migration journal).

---

## 1. Schema Definition Rules

All database tables and relations are declared in `shared/schema/`.

### Guidelines for Safe Schema Evolution:
1. **Always Provide Default Values for New Columns**:
   - ❌ Adding a non-nullable column without a default locks the table and fails on existing rows.
   - ✅ Always provide `.default(...)` or allow nullable:
     ```typescript
     export const missions = pgTable("missions", {
       id: serial("id").primaryKey(),
       // Safe new column
       retryCount: integer("retry_count").default(0).notNull(),
       archivedAt: timestamp("archived_at"),
     });
     ```
2. **Foreign Key Relations**:
   - Explicitly define `onDelete` cascade or restrict behaviors:
     ```typescript
     organizationId: integer("organization_id")
       .references(() => organizations.id, { onDelete: "cascade" }),
     ```
3. **Audit Columns**:
   - Include standard timestamp audit fields on operational tables:
     ```typescript
     createdAt: timestamp("created_at").defaultNow().notNull(),
     updatedAt: timestamp("updated_at").defaultNow().notNull(),
     ```

---

## 2. Migration Generation Workflow

Follow this step-by-step sequence to author and apply a database migration:

### Step 1: Update the Schema in Code
Modify or add table definitions in `shared/schema/`. Export newly created tables in [`shared/schema/index.ts`](../../shared/schema/index.ts).

### Step 2: Generate the Migration SQL
Run Drizzle Kit to create the migration SQL script and update the journal:
```bash
npm run db:generate
```
This generates a new timestamped file in `migrations/` and appends an entry to `migrations/meta/_journal.json`.

### Step 3: Validate Migration Journal
Ensure the journal sequence has no duplicate tags or gaps:
```bash
npm run check:migration-journal
```

### Step 4: Apply the Migration
Execute the migration against the target database:
```bash
npm run db:migrate
```

### Step 5: Verify Zero Schema Drift
Validate that the running database schema matches Drizzle's expectations:
```bash
npm run check:schema-drift
```

---

## 3. Dangerous Operations Requiring Human Confirmation

Under the **Accidental Data Loss Prevention** policy, the following commands must never be run autonomously:
- `DROP TABLE` / `DROP SCHEMA` / `TRUNCATE`.
- Destructive column drops (`ALTER TABLE ... DROP COLUMN ...`) without a data migration plan.
- Manual DB resets outside of dedicated local test databases.
