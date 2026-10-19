# 🗄️ Database Service (`services/database`)

The Database Service manages the schema and persistence layer for Oddjob's ephemeral and high-velocity telemetry data. While the main application state is stored in a primary PostgreSQL instance (managed via Drizzle in `shared/schema`), this service focus on short-term, high-volume "Psychologist" data that requires frequent purging.

## Mach 3 Service Role: `database`
In the Mach 3 distributed architecture, this service ensures that the persistence layer is optimized for the specific needs of each pod, providing isolated schemas and maintenance procedures for telemetry and audit logs.

## Core Responsibilities
- **Ephemeral State Tracking**: Stores the immediate "Somatic" and "Intent" states of users (`contact_intent_states`) for real-time behavior analysis.
- **Engagement Logging**: Records short-term interactions with AI strategies (`engagement_logs`) to inform reinforcement learning models.
- **Data Lifecycle Management**: Implements "The Shredder"—a stored procedure that hard-deletes data older than 48 hours to maintain high performance and minimize storage costs.

## Key Files
- `ephemeral_schema.sql`: Raw SQL definitions for the short-term telemetry tables and the purge procedure.

## Implementation Details
- **The Shredder**: A PL/pgSQL procedure (`purge_ephemeral_data`) that runs on a schedule (typically via pg_cron or an external trigger) to prune `contact_intent_states` and `engagement_logs`.
- **Indexing**: Optimized for `user_fingerprint` and `created_at` to support rapid lookups during the `ingestor` and `consumer` workflows.

## Dependencies
- **PostgreSQL**: The underlying relational engine.
- **Drizzle ORM**: Used by the main `api` and `mission` pods to interact with the broader system schema.

## Testing Status
- [ ] Schema Validation: 🟢 Successfully deployed in development environments
- [ ] Purge Logic: 🟡 Verified via manual script execution; awaiting automated cron verification
