#!/usr/bin/env ts-node
import "dotenv/config";
import { sql } from "drizzle-orm";
import { Command } from "commander";
import { db } from "../../server/db/index.js";
import { users } from "@shared/schema";

const program = new Command();

program
    .name("db")
    .description("A CLI for managing the database")
    .version("1.0.0");

program
    .command("check-schema")
    .description("Check the database schema")
    .action(async () => {
        try {
            const tables = ['orgs', 'users', 'mission_runs', 'missions', 'pipelines', 'jobs', 'suppression_policies'];

            for (const table of tables) {
                console.log(`\n--- Checking table: ${table} ---`);
                try {
                    const constraints = await db.execute(sql`
                        SELECT conname, contype, a.attname
                        FROM pg_constraint c
                        JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
                        WHERE c.conrelid = ${table}::regclass;
                    `);
                    if (constraints.rows.length === 0) {
                        console.warn(`[WARNING] Table '${table}' has NO CONSTRAINTS!`);
                    } else {
                        console.table(constraints.rows);
                    }
                } catch (e: any) {
                    console.error(`Error checking table '${table}':`, e.message);
                }
            }

            process.exit(0);
        } catch (err) {
            console.error("Failed to check schema:", err);
            process.exit(1);
        }
    });

program
    .command("inspect")
    .description("Inspect the database")
    .action(async () => {
        try {
            console.log(`\n--- Searching for Mission Launcher Job ---`);

            const jobs = await db.execute(sql`
                SELECT id, name, type, config, lifecycle_status
                FROM jobs
                WHERE name ILIKE '%Mission Launcher%'
            `);
            console.log("Jobs found:", JSON.stringify(jobs.rows, null, 2));

            for (const j of jobs.rows) {
                const deployments = await db.execute(sql`
                    SELECT id, slug, title, is_active
                    FROM agent_deployments
                    WHERE job_id = ${j.id}
                `);
                console.log(`Deployments for Job ${j.id}:`, JSON.stringify(deployments.rows, null, 2));
            }

            process.exit(0);
        } catch (err) {
            console.error("Search failed:", err);
            process.exit(1);
        }
    });

program.parse();
