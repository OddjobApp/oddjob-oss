import { db } from "../database_service.js";
import { apps, appDeployments, appInstances } from "@shared/schema/index.js";
import { eq, and, or, like, isNotNull } from "drizzle-orm";

async function cleanLegacySharedServers() {
    console.log("🧹 Initializing Legacy Shared Server Clean & Backfill...");
    try {
        const allApps = await db.select().from(apps);
        console.log(`Found ${allApps.length} apps total in database.`);

        let updatedCount = 0;

        for (const app of allApps) {
            const config = app.config as any || {};
            const interactionModel = config.cycleApp?.interactionModel;
            const isShared = interactionModel === "shared-server" || 
                             app.slug.startsWith("procurement-workbench") || 
                             app.slug.startsWith("vendor-workbench");

            if (isShared && (app.dockerImage !== null || !config.tokenizedUI)) {
                console.log(`  Converting app [${app.slug}] (ID: ${app.id}) to Tokenized UI...`);
                
                const appName = app.name || "Workbench";
                const tokenizedUI = {
                    type: "Dashboard",
                    props: {
                        title: `${appName} - Overview`,
                        description: app.description || `Dynamic Tokenized UI dashboard for ${appName}.`
                    },
                    layout: {
                        type: "Grid",
                        props: { columns: 3 },
                        children: [
                            {
                                type: "StatCard",
                                props: {
                                    title: "Operational Status",
                                    value: "Active",
                                    description: "Systems online and healthy",
                                    trend: "up"
                                }
                            },
                            {
                                type: "StatCard",
                                props: {
                                    title: "Pending Tasks",
                                    value: "0",
                                    description: "Awaiting review or decision",
                                    trend: "neutral"
                                }
                            },
                            {
                                type: "StatCard",
                                props: {
                                    title: "Weekly Throughput",
                                    value: "100%",
                                    description: "Task completion rate",
                                    trend: "up"
                                }
                            },
                            {
                                type: "Card",
                                props: {
                                    title: "Platform Overview",
                                    description: "Activity log and compliance monitoring."
                                },
                                children: [
                                    {
                                        type: "DataTable",
                                        props: {
                                            columns: ["Task ID", "Assigned Agent", "Compliance Status"],
                                            data: [
                                                ["TASK-001", "ai-specialist", "Compliant"],
                                                ["TASK-002", "ai-analyst", "Compliant"]
                                            ]
                                        }
                                    }
                                ]
                            },
                            {
                                type: "Card",
                                props: {
                                    title: "Control Deck",
                                    description: "Direct action interface for the workbench."
                                },
                                children: [
                                    {
                                        type: "FormInput",
                                        props: {
                                            id: "action_notes",
                                            label: "Action Notes",
                                            placeholder: "Enter details..."
                                        }
                                    },
                                    {
                                        type: "ActionButton",
                                        props: {
                                            label: "Dispatch Decision",
                                            endpoint: "/api/pipelines",
                                            method: "GET"
                                        }
                                    }
                                ]
                            }
                        ]
                    }
                };

                const updatedConfig = {
                    ...config,
                    tokenizedUI
                };

                // Clear dockerImage and write schema
                await db.update(apps)
                    .set({
                        dockerImage: null,
                        config: updatedConfig
                    })
                    .where(eq(apps.id, app.id));

                // Update deployment to active
                await db.update(appDeployments)
                    .set({
                        status: "active",
                        url: null
                    })
                    .where(eq(appDeployments.appId, app.id));

                // Mark any running instances as stopped
                await db.update(appInstances)
                    .set({ status: "stopped" })
                    .where(eq(appInstances.deploymentId, app.id));

                updatedCount++;
            }
        }

        console.log(`\n✅ Completed! Successfully backfilled and de-containerized ${updatedCount} shared-server app(s).`);
        process.exit(0);
    } catch (err: any) {
        console.error("❌ Clean failed:", err.stack || err.message);
        process.exit(1);
    }
}

cleanLegacySharedServers();
