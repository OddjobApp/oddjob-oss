
import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
});

async function checkDbHealth() {
    try {
        console.log("Checking DB Connection and Locks...");
        const client = await pool.connect();
        try {
            console.log("Connected to DB successfully.");
            
            console.log("\n--- Active Connections ---");
            const connRes = await client.query("SELECT count(*) FROM pg_stat_activity");
            console.log("Total Connections:", connRes.rows[0].count);

            console.log("\n--- Connection Details (Non-idle) ---");
            const activityRes = await client.query("SELECT pid, state, query, wait_event_type, wait_event FROM pg_stat_activity WHERE state != 'idle' LIMIT 10");
            activityRes.rows.forEach(r => {
                console.log(`- PID ${r.pid}: ${r.state} | Wait: ${r.wait_event_type || 'none'}:${r.wait_event || 'none'}`);
                console.log(`  Query: ${r.query.slice(0, 100)}...`);
            });

            console.log("\n--- Locks ---");
            const lockRes = await client.query(`
                SELECT 
                    blocked_locks.pid     AS blocked_pid,
                    blocked_activity.query  AS blocked_query,
                    blocking_locks.pid     AS blocking_pid,
                    blocking_activity.query AS blocking_query,
                    blocked_activity.state  AS blocked_state,
                    blocking_activity.state AS blocking_state
                FROM  pg_catalog.pg_locks         blocked_locks
                JOIN pg_catalog.pg_stat_activity blocked_activity  ON blocked_locks.pid = blocked_activity.pid
                JOIN pg_catalog.pg_locks         blocking_locks 
                    ON blocking_locks.locktype = blocked_locks.locktype
                    AND blocking_locks.DATABASE      IS NOT DISTINCT FROM blocked_locks.DATABASE
                    AND blocking_locks.relation      IS NOT DISTINCT FROM blocked_locks.relation
                    AND blocking_locks.page          IS NOT DISTINCT FROM blocked_locks.page
                    AND blocking_locks.tuple         IS NOT DISTINCT FROM blocked_locks.tuple
                    AND blocking_locks.virtualxid    IS NOT DISTINCT FROM blocked_locks.virtualxid
                    AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
                    AND blocking_locks.classid       IS NOT DISTINCT FROM blocked_locks.classid
                    AND blocking_locks.objid         IS NOT DISTINCT FROM blocked_locks.objid
                    AND blocking_locks.objsubid      IS NOT DISTINCT FROM blocked_locks.objsubid
                    AND blocking_locks.pid != blocked_locks.pid
                JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_locks.pid = blocking_activity.pid
                WHERE NOT blocked_locks.granted
            `);
            console.log("Blocking locks found:", lockRes.rows.length);
            lockRes.rows.forEach(r => {
                console.log(`- PID ${r.blocked_pid} (${r.blocked_state}) is blocked by PID ${r.blocking_pid} (${r.blocking_state})`);
                console.log(`  Blocked Query:  ${r.blocked_query.slice(0, 200)}...`);
                console.log(`  Blocking Query: ${r.blocking_query.slice(0, 200)}...`);
            });

        } finally {
            client.release();
        }
    } catch (error) {
        console.error("DB Check Failed:", error.message);
    } finally {
        await pool.end();
    }
}

checkDbHealth();
