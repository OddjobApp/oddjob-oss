#!/usr/bin/env ts-node
import "dotenv/config";
import { sql } from "drizzle-orm";
import { Command } from "commander";
import { db } from "../../server/db/index.js";

const program = new Command();

program
    .name("agents")
    .description("A CLI for managing agents")
    .version("1.0.0");

program
    .command("list")
    .description("List all agents")
    .action(async () => {
        try {
            const res = await db.execute(sql`SELECT id, name FROM agents`);
            console.log('Agents in database:');
            console.log(JSON.stringify(res.rows, null, 2));
            process.exit(0);
        } catch (e) {
            console.error(e);
            process.exit(1);
        }
    });

program.parse();
