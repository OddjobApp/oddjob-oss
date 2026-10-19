
import { promptService } from "@domain/ai/core/prompt.service.js";
import pg from 'pg';
const { Pool } = pg;

async function debugPrompt() {
    const pool = new Pool({ connectionString: "postgresql://postgres:postgres@localhost:5433/oddjob" });
    try {
        const jobRes = await pool.query("SELECT * FROM jobs WHERE id = 21");
        const job = jobRes.rows[0];
        const depRes = await pool.query("SELECT * FROM agent_deployments WHERE job_id = 21");
        const dep = depRes.rows[0];

        const clientContext = {
            jobId: 21,
            branding: { title: dep.title },
            page: 'agent_deployment'
        };

        const userContext = {
            organizationId: job.organization_id,
            userId: job.created_by,
            isAdmin: true,
            isSuperAdmin: false,
            isOrgAdmin: true
        };

        // Allowed tools normally come from job.config.allowedTools
        let allowedTools = job.config.allowedTools || [];
        if (!allowedTools.includes("show_pipeline_input_form")) {
            allowedTools.push("show_pipeline_input_form");
        }

        const prompt = await promptService.buildSystemPrompt(
            clientContext,
            userContext,
            allowedTools,
            job.config.provider,
            job.config.model,
            undefined,
            job.config
        );

        console.log("--- SYSTEM PROMPT FOR AGENT 21 ---");
        console.log(prompt);
        console.log("--- END PROMPT ---");

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

debugPrompt();
