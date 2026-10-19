# Entity Relationship Diagram (ERD) Specification

**Project/Feature Name:** [Name]
**Author:** [DBA / Systems Engineer]
**Date:** [Date]

## 1. Schema Description
[Provide a summary of the database changes or schema updates proposed for this cycle.]

## 2. Entities & Fields

### Table: [Table Name]
- **Primary Key:** [PK field]
- **Description:** [What does this table store?]

| Column Name | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | SERIAL | PRIMARY KEY | Unique ID |
| | | | |

## 3. Relationships & Foreign Keys
- `table_a.b_id` references `table_b.id` (Many-to-One)

## 4. Rollback Plan
- [SQL migration rollback queries or Drizzle revert actions]
