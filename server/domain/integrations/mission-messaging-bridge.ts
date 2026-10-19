
import { missionEventBus, MissionEvent } from "@domain/mission/core/mission-event-bus.js";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { missionRuns, saasConnectors } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { getSlackClient } from "./slack-service.js";
import { sentinelEventBus, SentinelEvent } from "@domain/agents/core/sentinel-event-bus.js";

const logger = createLogger("MissionMessagingBridge");

/**
 * MissionMessagingBridge
 * 
 * Bridges mission execution events (traces, phase changes) to messaging platforms
 * (Slack, Teams) if the mission was launched from there.
 */
export const missionMessagingBridge = {
    init() {
        logger.info("[MissionMessagingBridge] Initializing bridge listeners...");

        // 1. Trace Appended -> Stream relevant updates to chat
        missionEventBus.on(MissionEvent.TRACE_APPENDED, async ({ missionRunId, traceEntry }) => {
            // Only post "high-value" traces to avoid noise
            const isMilestone = ['strategist', 'critic', 'error'].includes(traceEntry.type) || 
                              traceEntry.event === 'blueprint_created' || 
                              traceEntry.event === 'vibe_audit';
            
            if (!isMilestone) return;

            try {
                const context = await this.getMissionMessagingContext(missionRunId);
                if (!context || !context.threadTs) return;

                const client = await this.getPlatformClient(context.platform, context.organizationId);
                if (!client) return;

                let message = "";
                if (traceEntry.type === 'strategist') {
                    message = `?? **Strategist Update:** ${traceEntry.note}`;
                } else if (traceEntry.type === 'critic') {
                    message = `?? **Vibe Audit:** ${traceEntry.note}\n*Alignment Score:* \`${traceEntry.score}/1.0\``;
                } else if (traceEntry.type === 'error') {
                    message = `?? **Execution Error:** \`${traceEntry.event}\`\n\n> ${traceEntry.note || traceEntry.error}`;
                }

                if (message) {
                    await this.postToPlatform(client, context.platform, context.channelId, message, context.threadTs);
                }
            } catch (err: any) {
                logger.error(`[MissionMessagingBridge] Trace notification failed: ${err.message}`);
            }
        });

        // 2. Phase Transition -> Alert when orders are needed
        missionEventBus.on(MissionEvent.PHASE_TRANSITION, async ({ missionRunId, phase }) => {
            if (phase !== 'WAITING_FOR_ORDERS') return;

            try {
                const context = await this.getMissionMessagingContext(missionRunId);
                if (!context || !context.threadTs) return;

                const client = await this.getPlatformClient(context.platform, context.organizationId);
                if (!client) return;

                if (!context.missionId) return;
                const blocks = this.getWaitingForOrdersBlocks(context.missionId, missionRunId.toString());
                const text = "?? **Awaiting Orders:** Mission is waiting for your approval to proceed.";

                await this.postToPlatform(client, context.platform, context.channelId, text, context.threadTs, blocks);
            } catch (err: any) {
                logger.error(`[MissionMessagingBridge] Phase notification failed: ${err.message}`);
            }
        });

        // 3. Sentinel Insight -> Proactive notification
        sentinelEventBus.on(SentinelEvent.INSIGHT_GENERATED, async ({ missionRunId, message, attributes }) => {
            try {
                const context = await this.getMissionMessagingContext(missionRunId);
                if (!context || !context.threadTs) return;

                const client = await this.getPlatformClient(context.platform, context.organizationId);
                if (!client) return;

                const text = `?? **Sentinel Insight:** ${message}`;
                const blocks = [
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: `?? **Sentinel Insight:** ${message}`
                        }
                    }
                ];

                if (attributes.skillId) {
                    blocks.push({
                        type: "context",
                        elements: [
                            { type: "mrkdwn", text: `*Target:* Skill \`${attributes.skillId}\` | *Reliability:* \`${attributes.reliabilityIndex}%\`` }
                        ]
                    } as any);
                }

                await this.postToPlatform(client, context.platform, context.channelId, text, context.threadTs, blocks);
            } catch (err: any) {
                logger.error(`[MissionMessagingBridge] Sentinel notification failed: ${err.message}`);
            }
        });

        // 4. Mission Completed — keyed on the MISSION's status becoming "completed",
        // not on a run finishing. It used to listen to the per-run COMPLETED event and
        // title the message "Mission #<run id>", a different id space from missions.
        missionEventBus.on(MissionEvent.MISSION_STATUS_COMPLETED, async ({ missionRunId, missionId, missionName }) => {
            try {
                const context = await this.getMissionMessagingContext(missionRunId);
                if (!context || !context.threadTs) return;

                const client = await this.getPlatformClient(context.platform, context.organizationId);
                if (!client) return;

                const text = `✅ **Mission Completed:** ${missionName}`;
                const blocks = [
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: `✅ **Mission Completed: ${missionName}**\n\nIts deliverable is ready for review in the dashboard.`
                        }
                    },
                    {
                        type: "actions",
                        elements: [
                            {
                                type: "button",
                                text: { type: "plain_text", text: "Review Deliverable" },
                                url: `${process.env.APP_URL || 'http://localhost:5000'}/missions/${missionId}`,
                                action_id: `view_mission_final_${missionId}_${missionRunId}`
                            }
                        ]
                    }
                ];

                await this.postToPlatform(client, context.platform, context.channelId, text, context.threadTs, blocks);
            } catch (err: any) {
                logger.error(`[MissionMessagingBridge] Completion notification failed: ${err.message}`);
            }
        });

        // 5. Mission Failed
        missionEventBus.on(MissionEvent.FAILED, async ({ missionRunId }) => {
            try {
                const context = await this.getMissionMessagingContext(missionRunId);
                if (!context || !context.threadTs) return;

                const client = await this.getPlatformClient(context.platform, context.organizationId);
                if (!client) return;

                const text = "🛑 **Mission Failed**";
                const blocks = [
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: `🛑 **Mission #${missionRunId} Failed**\n\nAn error occurred that prevented the mission from continuing. Check the logs for details.`
                        }
                    },
                    {
                        type: "actions",
                        elements: [
                            {
                                type: "button",
                                text: { type: "plain_text", text: "Debug in Dashboard" },
                                url: `${process.env.APP_URL || 'http://localhost:5000'}/missions/${context.missionId}`,
                                action_id: `debug_mission_${missionRunId}`
                            }
                        ]
                    }
                ];

                await this.postToPlatform(client, context.platform, context.channelId, text, context.threadTs, blocks);
            } catch (err: any) {
                logger.error(`[MissionMessagingBridge] Failure notification failed: ${err.message}`);
            }
        });

        // 6. App Forged (New Link Delivery)
        missionEventBus.on(MissionEvent.APP_FORGED, async ({ missionRunId, name, slug }) => {
            try {
                const context = await this.getMissionMessagingContext(missionRunId);
                if (!context || !context.threadTs) return;

                const client = await this.getPlatformClient(context.platform, context.organizationId);
                if (!client) return;

                const appUrl = `${process.env.APP_URL || 'http://localhost:5000'}/a/${slug}`;
                const text = `🚀 **App Forged Successfully!** Your new app "${name}" is ready.`;
                const blocks = [
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: `🚀 **App Forged Successfully!**\n\nI have finished building **${name}** based on your request. You can access it immediately at the link below.`
                        }
                    },
                    {
                        type: "actions",
                        elements: [
                            {
                                type: "button",
                                text: { type: "plain_text", text: "Open Application" },
                                style: "primary",
                                url: appUrl,
                                action_id: `open_app_${slug}`
                            },
                            {
                                type: "button",
                                text: { type: "plain_text", text: "View Details" },
                                url: `${process.env.APP_URL || 'http://localhost:5000'}/missions/${context.missionId}`,
                                action_id: `view_forge_mission_${missionRunId}`
                            }
                        ]
                    }
                ];

                await this.postToPlatform(client, context.platform, context.channelId, text, context.threadTs, blocks);
            } catch (err: any) {
                logger.error(`[MissionMessagingBridge] App forged notification failed: ${err.message}`);
            }
        });
    },

    async postToPlatform(client: any, platform: string, channelId: string, text: string, threadTs?: string, blocks?: any[]) {
        try {
            if (platform === 'slack') {
                await client.postMessage(channelId, text, blocks, threadTs);
            } else {
                await client.postMessage(channelId, text, undefined, threadTs);
            }
        } catch (err: any) {
            logger.error(`Failed to post to ${platform}: ${err.message}`);
        }
    },

    getWaitingForOrdersBlocks(missionId: number, runId: string) {
        return [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `?? **Awaiting Orders:** Mission \`${missionId}\` has completed its current cycle and is waiting for your approval to proceed.`
                }
            },
            {
                type: "actions",
                elements: [
                    {
                        type: "button",
                        text: { type: "plain_text", text: "Approve & Continue" },
                        style: "primary",
                        value: "approve",
                        action_id: `mission:approve:${runId}`
                    },
                    {
                        type: "button",
                        text: { type: "plain_text", text: "Stop Mission" },
                        style: "danger",
                        value: "reject",
                        action_id: `mission:reject:${runId}`
                    },
                    {
                        type: "button",
                        text: { type: "plain_text", text: "Steer Mission" },
                        style: "primary",
                        value: "steer",
                        action_id: `mission:steer:${runId}`
                    },
                    {
                        type: "button",
                        text: { type: "plain_text", text: "View Dashboard" },
                        url: `${process.env.APP_URL || 'http://localhost:5000'}/missions/${missionId}`,
                        action_id: `view_mission:${missionId}`
                    }
                ]
            }
        ];
    },

    async getMissionMessagingContext(missionRunId: number) {
        const [run] = await db.select({ 
            missionId: missionRuns.missionId, 
            organizationId: missionRuns.organizationId,
            missionContext: missionRuns.missionContext 
        })
        .from(missionRuns)
        .where(eq(missionRuns.id, missionRunId))
        .limit(1);

        if (!run) return null;

        const blackboard = (run.missionContext as any) || {};
        if (blackboard.source === 'conversational_bridge') {
            return {
                missionId: run.missionId,
                platform: blackboard.platform,
                channelId: blackboard.channelId,
                threadTs: blackboard.threadTs,
                organizationId: run.organizationId
            };
        }
        return null;
    },

    async getPlatformClient(platform: string, orgId: number | null) {
        if (platform === 'slack') {
            const [connector] = await db.select()
                .from(saasConnectors)
                .where(and(
                    eq(saasConnectors.platform, 'slack'),
                    eq(saasConnectors.status, 'active'),
                    orgId ? eq(saasConnectors.orgId, orgId) : undefined
                ))
                .limit(1);
            
            const token = (connector?.config as any)?.bot_token;
            if (!token) return null;
            return await getSlackClient(token);
        }
        return null;
    }
};
