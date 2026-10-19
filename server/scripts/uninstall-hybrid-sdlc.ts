import "dotenv/config";
import { db } from "../database_service.js";
import { 
    apps, 
    appDeployments, 
    missionTemplates, 
    documentTemplates, 
    schedules, 
    scheduledJobs, 
    jobs,
    appUserUsage
} from "@shared/schema/index.js";
import { teams, teamMembers } from "@shared/schema/team-collaboration.js";
import { eq, inArray, and } from "drizzle-orm";

async function main() {
    console.log("🧹 Beginning Teardown / Uninstallation of Hybrid SDLC Cycle & App...");

    const slug = "hybrid-sdlc";

    // 1. Find the App
    const [appRecord] = await db.select().from(apps).where(eq(apps.slug, slug)).limit(1);
    if (!appRecord) {
        console.log("ℹ️  Hybrid SDLC App record not found in database. Continuing with cycle cleanup...");
    } else {
        const appId = appRecord.id;

        // 2. Delete deployments and usage
        const deployments = await db.select().from(appDeployments).where(eq(appDeployments.appId, appId));
        const deploymentIds = deployments.map(d => d.id);
        
        if (deploymentIds.length > 0) {
            console.log(`🗑️  Deleting app user usage for ${deploymentIds.length} deployments...`);
            await db.delete(appUserUsage).where(inArray(appUserUsage.deploymentId, deploymentIds));
        }

        console.log("🗑️  Deleting app deployments...");
        await db.delete(appDeployments).where(eq(appDeployments.appId, appId));

        console.log("🗑️  Deleting app registry record...");
        await db.delete(apps).where(eq(apps.id, appId));
        console.log("✅ App and all deployments uninstalled.");
    }

    // 3. Clean up Team Topology (Alpha Squad)
    const alphaSquads = await db.select().from(teams).where(eq(teams.name, "Alpha Squad"));
    const squadIds = alphaSquads.map(t => t.id);
    if (squadIds.length > 0) {
        console.log(`🗑️  Deleting members from ${squadIds.length} Alpha Squad teams...`);
        await db.delete(teamMembers).where(inArray(teamMembers.teamId, squadIds));
        console.log("🗑️  Deleting Alpha Squad teams...");
        await db.delete(teams).where(inArray(teams.id, squadIds));
        console.log("✅ Team topology cleaned up.");
    }

    // 4. Clean up Mission Templates
    const missionNames = [
        "Project Initialization & Sprint Zero",
        "Sprint Kickoff & Planning",
        "Requirements & Design Analysis",
        "Core Application Development",
        "QA & Regression Testing",
        "Release Candidate & UAT",
        "Production Deployment",
        "Production Incident & Hotfix Routing"
    ];
    console.log("🗑️  Deleting SDLC Mission Templates...");
    await db.delete(missionTemplates).where(inArray(missionTemplates.name, missionNames));

    // 5. Clean up Document Templates
    const templateNames = [
        "prd_template",
        "erd_template",
        "api_spec_template",
        "system_architecture_template",
        "threat_model_template",
        "ui_ux_design_spec_template",
        "vsm_telemetry_report",
        "sprint_capacity_plan",
        "code_review_checklist",
        "qa_test_scenario",
        "qa_defect_report",
        "itil_change_record",
        "incident_postmortem",
        "release_notes_template"
    ];
    console.log("🗑️  Deleting SDLC Document Templates...");
    await db.delete(documentTemplates).where(inArray(documentTemplates.name, templateNames));

    // 6. Clean up Schedules & Scheduled Jobs
    const scheduleNames = [
        "daily_standup",
        "nightly_regression",
        "weekly_grooming",
        "capacity_sync"
    ];
    const targetSchedules = await db.select().from(schedules).where(inArray(schedules.name, scheduleNames));
    const scheduleIds = targetSchedules.map(s => s.id);
    if (scheduleIds.length > 0) {
        console.log("🗑️  Deleting Scheduled Jobs linked to SDLC schedules...");
        await db.delete(scheduledJobs).where(inArray(scheduledJobs.scheduleId, scheduleIds));
        console.log("🗑️  Deleting SDLC Schedules...");
        await db.delete(schedules).where(inArray(schedules.id, scheduleIds));
    }

    // 7. Clean up Jobs (Agents)
    const agentNames = [
        "Scrum Master & Agile Coach",
        "Systems Analyst",
        "UX Designer",
        "Backend Developer",
        "Frontend Developer",
        "Mobile Developer",
        "QA Automation Engineer",
        "Database Administrator",
        "Release Manager"
    ];
    console.log("🗑️  Deleting SDLC AI Agents / Jobs...");
    await db.delete(jobs).where(inArray(jobs.name, agentNames));

    console.log("==========================================");
    console.log("🧹 Teardown Completed Successfully!");
    console.log("==========================================");
    process.exit(0);
}

main().catch((err) => {
    console.error("❌ Teardown failed:", err);
    process.exit(1);
});
