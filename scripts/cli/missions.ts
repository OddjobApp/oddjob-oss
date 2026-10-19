#!/usr/bin/env ts-node
import "dotenv/config";
import { missionRuns } from "@shared/schema";
import { eq, desc, gte } from "drizzle-orm";
import { Command } from "commander";
import { db } from "../../server/db/index.js";
import { missions } from "@shared/schema";
import { sql } from "drizzle-orm";

const program = new Command();

program
    .name("missions")
    .description("A CLI for managing missions")
    .version("1.0.0");

program
    .command("list")
    .description("List all missions")
    .action(async () => {
        try {
            console.log("--- Mission Status Summary ---");

            const results = await db.select({
                id: missions.id,
                name: missions.name,
                runId: missionRuns.id,
                runStatus: missionRuns.status,
                failureReason: missionRuns.failureReason,
                cost: missionRuns.costUsd,
                updatedAt: missionRuns.updatedAt
            })
            .from(missions)
            .innerJoin(missionRuns, eq(missions.id, missionRuns.missionId))
            .where(gte(missions.id, 2010)) // Focus on missions created today
            .orderBy(desc(missionRuns.id));

            console.table(results);

            // Also check older active ones
            const activeOlder = await db.select({
                id: missions.id,
                name: missions.name,
                runId: missionRuns.id,
                runStatus: missionRuns.status,
                updatedAt: missionRuns.updatedAt
            })
            .from(missions)
            .innerJoin(missionRuns, eq(missions.id, missionRuns.missionId))
            .where(eq(missionRuns.status, 'active'))
            .limit(10);

            if (activeOlder.length > 0) {
                console.log("\n--- Other Active Runs ---");
                console.table(activeOlder);
            }

            process.exit(0);
        } catch (e) {
            console.error(e);
            process.exit(1);
        }
    });

program.parse();
