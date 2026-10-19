#!/usr/bin/env ts-node
import "dotenv/config";
import { Command } from "commander";
import { db } from "../../server/db/index.js";
import { pipelines, jobs } from "@shared/schema";
import { sql } from "drizzle-orm";

const program = new Command();

program
    .name("pipelines")
    .description("A CLI for managing pipelines")
    .version("1.0.0");

program
    .command("list")
    .description("List all pipelines")
    .action(async () => {
        try {
            console.log("--- Checking Pipelines ---");
            const allPipelines = await db.select().from(pipelines);
            console.log(`Found ${allPipelines.length} total pipelines.`);
            allPipelines.forEach((p: any) => {
                console.log(`- ID: ${p.id}, Name: "${p.name}", OrgID: ${p.organizationId}, Active: ${p.isActive}`);
            });

            console.log("\n--- Checking Jobs ---");
            const allJobs = await db.select().from(jobs);
            console.log(`Found ${allJobs.length} total jobs.`);
            allJobs.forEach((j: any) => {
                console.log(`- ID: ${j.id}, Name: "${j.name}", OrgID: ${j.organizationId}`);
            });

            process.exit(0);
        } catch (err) {
            console.error(err);
            process.exit(1);
        }
    });

program.parse();
