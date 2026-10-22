
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { saasConnectors, users, adminRoles, missionRuns } from "@shared/schema/index.js";
import { eq, and, sql, gte, desc } from "drizzle-orm";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { getSlackClient } from "./slack-service.js";
import { agentService } from "@domain/agents/agent.service.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { promptService } from "@domain/ai/core/prompt-service.js";
import { extractHashtags, hashtagToTopicName } from "./utils/hashtag-extractor.js";
import { missionRunService } from "@domain/mission/core/mission-run.service.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";

const logger = createLogger("ConversationalBridge");

export interface InboundMessage {
    platform: 'slack' | 'teams' | 'whatsapp' | 'telegram' | 'sms';
    channelId: string;
    userId: string;
    teamId?: string; // NEW: For multi-tenant organization resolution
    text: string;
    files?: any[];
    threadTs?: string;
    timestamp: string;
    hashtags?: string[]; // Extracted hashtags for topic tagging
    attachments?: any[]; // Processed file attachments for AI context
}

export const conversationalBridgeService = {
    /**
     * Handle an inbound message from a messaging platform
     */
    async handleInboundMessage(message: InboundMessage) {
        logger.info(`[ConversationalBridge] Processing ${message.platform} message: "${message.text.substring(0, 50)}..."`);

        // 1. Resolve Organization & Connector
        const connector = await this.resolveConnector(message);
        if (!connector) {
            logger.warn(`[TRACE-BRIDGE] No active ${message.platform} connector found for message in channel ${message.channelId}.`);
            return;
        }
        logger.info(`[TRACE-BRIDGE] Resolved connector ${connector.id} (Org: ${connector.orgId})`);

        const orgId = connector.orgId;
        const client = await this.getPlatformClient(connector);
        
        // 2. Resolve User Context
        const user = await this.resolveUser(message, client, orgId);
        const userId = user?.id || 'system';
        logger.info(`[TRACE-BRIDGE] Resolved user identity: ${userId} (Found: ${!!user})`);

        // 2b. EXTRACT HASHTAGS FROM MESSAGE (for knowledge graph topics)
        const { hashtags, cleanText } = extractHashtags(message.text);
        const topicNames = hashtags.map(hashtagToTopicName);
        if (hashtags.length > 0) {
            logger.info(`[TRACE-BRIDGE] Extracted hashtags: ${hashtags.join(', ')} -> topics: ${topicNames.join(', ')}`);
        }
        // Update message text to clean version (without hashtags)
        message.text = this.normalizePlatformText(message.platform, cleanText);
        message.hashtags = hashtags;

        // 2c. STORE MESSAGE AS KNOWLEDGE IF IT HAS HASHTAGS
        // This allows messages like "Decision made about #project-alpha" to be discoverable by topic
        if (hashtags.length > 0 && cleanText.length > 10) {
            try {
                const { documentService } = await import("@domain/knowledge/core/extraction/document-service.js");
                await documentService.createDocument({
                    title: `Slack message from #${message.channelId.substring(0, 8)}`,
                    summary: cleanText.substring(0, 200),
                    sourceType: 'slack_message',
                    textContent: cleanText,
                    metadata: {
                        source: 'slack',
                        platform: message.platform,
                        channelId: message.channelId,
                        userId: message.userId,
                        threadTs: message.threadTs,
                        timestamp: message.timestamp,
                        keywords: topicNames
                    },
                    topicNames: topicNames // Store hashtags as topics
                }, { ...getSystemOrgContext(orgId), userId });
                
                logger.info(`[TRACE-BRIDGE] Stored Slack message as knowledge document with topics: ${topicNames.join(', ')}`);
            } catch (storeErr: any) {
                logger.warn(`[TRACE-BRIDGE] Failed to store message as knowledge: ${storeErr.message}`);
                // Non-blocking - continue processing the message
            }
        }

        // 3. PRE-PROCESS ATTACHMENTS (Multi-modal support)
        let combinedText = message.text;
        const processedAttachments: any[] = [];

        if (message.files && message.files.length > 0) {
            const { transcriptionService } = await import("@domain/media/transcription-service.js");
            
            for (const file of message.files) {
                try {
                    const buffer = await (client as any).downloadFile(file.url_private);
                    const isAudio = file.mimetype?.startsWith('audio/') || 
                                   ['.m4a', '.mp3', '.wav', '.ogg'].some(ext => file.name?.endsWith(ext));

                    if (isAudio) {
                        // 3a. Voice-to-Mission transcription
                        const result = await transcriptionService.transcribe(buffer, file.name, orgId);
                        if (result.text) {
                            combinedText = (combinedText + " " + result.text).trim();
                        }
                    } else {
                        // 3b. Cache images/docs for Agent Service context
                        const [processed] = await agentService.processUploadedFiles([{
                            buffer,
                            mimetype: file.mimetype,
                            originalname: file.name,
                            size: file.size
                        } as any]);
                        processedAttachments.push(processed);
                    }
                } catch (err: any) {
                    logger.error(`[ConversationalBridge] File processing failed for ${file.name}: ${err.message}`);
                }
            }
        }
        message.attachments = processedAttachments;
        combinedText = this.normalizePlatformText(message.platform, combinedText);

        // 4. CHECK FOR EXISTING THREAD (Context Isolation)
        if (message.threadTs) {
            const existingRunId = await this.findMissionByThread(message.threadTs);
            if (existingRunId) {
                logger.info(`[TRACE-BRIDGE] Routing message to existing mission ${existingRunId} (Thread: ${message.threadTs})`);
                await this.routeCommandToMission(existingRunId, { ...message, text: combinedText }, client, orgId, userId);
                return;
            } else {
                logger.debug(`[TRACE-BRIDGE] Thread ${message.threadTs} not associated with any active mission.`);
            }
        }

        // 5. Handle deterministic Slack commands before invoking the heavier agent loop.
        if (await this.tryHandleFastPath({ ...message, text: combinedText }, client, orgId)) {
            return;
        }

        // 6. Send "Thinking" acknowledgement
        await this.sendThinkingIndicator(client, message);

        try {
            // 7. MODE SWITCHING COMMANDS
            const normalizedText = combinedText.toLowerCase().trim();
            // Mode switching — recognize "execute mode" / "planning mode" as a PREFIX
            // and process any trailing request in the SAME message, so "execute mode.
            // do X" switches AND handles X (instead of requiring a standalone command).
            // `ct` preserves original case for slicing the trailing request; the
            // regexes run on `normalizedText` (already lowercased). The lookahead
            // requires a word boundary so "planning modes…"/"execute modeX" don't match,
            // then the trailing separators are consumed so the remainder is clean.
            const ct = combinedText.trim();
            const planMatch = normalizedText.match(/^(switch to )?planning mode(?=[\s.,:!?-]|$)[\s.,:!?-]*/);
            const execMatch = normalizedText.match(/^(switch to )?execute mode(?=[\s.,:!?-]|$)[\s.,:!?-]*/);
            if (planMatch) {
                await this.setChatMode(message.channelId, 'planning');
                const rest = ct.slice(planMatch[0].length).trim();
                if (!rest) {
                    await client.postMessage(message.channelId, "🧭 *Mode Switched: Planning.* I'll describe what I'll do before acting. Say `execute mode` to act directly.", undefined, message.threadTs);
                    return;
                }
                await this.handleAgentChat({ ...message, text: rest }, orgId, userId, client);
                return;
            } else if (execMatch) {
                await this.setChatMode(message.channelId, 'execute');
                const rest = ct.slice(execMatch[0].length).trim();
                if (!rest) {
                    await client.postMessage(message.channelId, "🚀 *Mode Switched: Execute.* I'll act directly when commanded.", undefined, message.threadTs);
                    return;
                }
                await this.handleAgentChat({ ...message, text: rest }, orgId, userId, client);
                return;
            }

            // Fast-path for "Yes" confirmation in Planning Mode
            const confirmationPattern = /^(yes|yep|yeah|do it|proceed|go|confirm|execute|ok|okay|sure|make it so)(\s|[.!?]|$)/i;
            if (confirmationPattern.test(normalizedText) && normalizedText.split(' ').length <= 3) {
                 const currentMode = await this.getChatMode(message.channelId);
                 if (currentMode === 'planning') {
                     logger.info(`[ConversationalBridge] Detected text-based confirmation: "${normalizedText}". Switching to EXECUTE mode.`);
                     await this.setChatMode(message.channelId, 'execute');
                     await client.postMessage(message.channelId, "✅ *Execute Mode Activated.* Proceeding with the plan...", undefined, message.threadTs);
                     // We fall through to handleAgentChat so the agent sees the "Yes" and actually executes.
                 }
            }

            // 7. IDENTITY & CAPABILITY FAST-PATH (Bypass RAG fallback)
            const identityPattern = /^(who are you|what is your name|what can you do|what access do you have|your purpose|who created you|identify yourself)(\s|[.!?]|$)/i;
            if (identityPattern.test(normalizedText)) {
                logger.info(`[ConversationalBridge] Identity query detected. Routing directly to Agent Service for persona consistency.`);
                await this.handleAgentChat({ ...message, text: combinedText }, orgId, userId, client);
                return;
            }

            // 8. Call Agent Service for unified reasoning
            await this.handleAgentChat({ ...message, text: combinedText }, orgId, userId, client);

        } catch (err: any) {
            logger.error(`[ConversationalBridge] Failed to handle message: ${err.message}`);
            await client.postMessage(message.channelId, `?? **Oddjob Encountered an Error**\n\nI tried to process your request but something went wrong: \`${err.message}\``, undefined, message.threadTs);
        }
    },

    async findMissionByThread(threadTs: string): Promise<number | null> {
        const { missionRuns } = await import("@shared/schema/index.js");
        const [run] = await db.select({ id: missionRuns.id })
            .from(missionRuns)
            .where(sql`mission_context->>'threadTs' = ${threadTs}`)
            .limit(1);
        
        return run?.id || null;
    },

    async routeCommandToMission(runId: number, message: InboundMessage, client: any, orgId: number, userId: string) {
        const { rollingWaveOrchestratorService } = await import("@domain/mission/core/rolling-wave-orchestrator.service.js");
        const { scheduleMissionWave } = await import("@domain/mission/infrastructure/rolling-wave-queue.js");
        const { missionRuns } = await import("@shared/schema/index.js");

        // 1. Append message to mission blackboard / instructions
        const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);
        if (!run) return;

        const currentContext = (run.missionContext as any) || {};
        const updatedContext = {
            ...currentContext,
            lastUserCommand: message.text,
            pendingAttachments: message.attachments || [], // Pass processed attachments to orchestrator
            phase: 'PLANNING' // Move back to planning to process the new command
        };

        await db.update(missionRuns)
            .set({ 
                missionContext: updatedContext,
                status: 'active',
                updatedAt: new Date()
            })
            .where(eq(missionRuns.id, runId));

        // 2. Handle Attachments if any
        if (message.files && message.files.length > 0 && run.missionId) {
            const topicNames = (message.hashtags || []).map(hashtagToTopicName);
            await this.handleAttachments(run.missionId, message.files, client, orgId, userId, topicNames);
        }

        // 3. Trigger immediate cycle
        await scheduleMissionWave({ missionRunId: runId, userId, orgId });

        // 4. Acknowledge
        await client.postMessage(message.channelId, "?? **Command Received:** Resuming mission with your new instructions...", undefined, message.threadTs);
    },

    async handleAgentChat(message: InboundMessage, orgId: number, userId: string, client: any) {
        const mode = await this.getChatMode(message.channelId);
        const userContext = await this.getUserContext(userId, orgId);

        // Track platform-specific context. Only Slack renders block-kit; for
        // SMS/WhatsApp/Telegram the client's postMessage ignores the blocks
        // argument, so report that honestly rather than as 'slack'.
        const context = {
            platform: message.platform,
            channelId: message.channelId,
            threadTs: message.threadTs,
            teamId: message.teamId,
            mode: mode,
            // In execute mode the user has opted into direct action, so treat it as
            // confirmed — otherwise the copilot returns a dry-run "confirm first" preview
            // and never actually runs tools (discover/propose).
            confirmedExecution: mode === 'execute',
            isConversational: true,
            interface: {
                surface: message.platform,
                responseStyle: 'concise_threaded',
                supportsBlocks: message.platform === 'slack',
                canAskForClarification: true
            },
            message: {
                timestamp: message.timestamp,
                hasAttachments: (message.attachments?.length || 0) > 0
            }
        };

        const result = await agentService.chat({
            message: message.text,
            attachments: message.attachments,
            context,
            userContext,
        });

        let slackBlocks: any[] | undefined = undefined;
        let cleanResponse = result.response || "";

        // Strip internal verification prefixes that are not meant for the user
        if (cleanResponse.startsWith("[Verification: ")) {
            cleanResponse = cleanResponse.replace(/^\[Verification: (PASSED|FAILED)\] /, '');
        }

        // Intercept mode switch request from agent tools (can be embedded in the response)
        if (cleanResponse && cleanResponse.includes("mode_switch_request")) {
            try {
                // Find the JSON block more reliably
                const match = cleanResponse.match(/\{"type":\s*"mode_switch_request".*?\}/s);
                if (match) {
                    const request = JSON.parse(match[0]);
                    const reason = request.reason || "I need to switch to Execute mode to carry out this plan.";
                    
                    slackBlocks = [
                        {
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: `🚀 *Plan Ready for Execution*\n\n${cleanResponse}\n\n*Shall I switch to Execute mode and proceed?*`
                            }
                        },
                        {
                            type: "actions",
                            elements: [
                                {
                                    type: "button",
                                    text: { type: "plain_text", text: "Approve & Execute" },
                                    style: "primary",
                                    action_id: "approve_execute_mode",
                                    value: "execute"
                                },
                                {
                                    type: "button",
                                    text: { type: "plain_text", text: "Stay in Planning" },
                                    action_id: "stay_planning_mode",
                                    value: "planning"
                                }
                            ]
                        }
                    ];
                }
            } catch (e) {
                logger.error("[ConversationalBridge] Failed to parse mode_switch_request JSON", e);
            }
        } else if (cleanResponse && cleanResponse.includes("approval_request")) {
            try {
                const match = cleanResponse.match(/\{"type":\s*"approval_request".*?\}/s);
                if (match) {
                    const request = JSON.parse(match[0]);
                    const toolName = request.toolName || request.tool || "unknown_tool";
                    const toolArgs = request.toolArgs || request.args || {};
                    const reason = request.reason || "Governed action requires authorization";
                    const missionRunId = request.missionRunId || request.runId || 0;

                    // Insert approval request in db
                    const { db } = await import("@server/database_service.js");
                    const { approvalRequests } = await import("@shared/schema/index.js");
                    const crypto = await import("crypto");
                    const token = crypto.randomBytes(16).toString("hex");

                    const [inserted] = await db.insert(approvalRequests).values({
                        executionId: missionRunId.toString(),
                        toolName,
                        toolArgs,
                        approverType: "internal",
                        approverEmail: "slack@oddjob.ai",
                        status: "pending",
                        token,
                        organizationId: orgId,
                        modifiedOutput: {
                            tool: toolName,
                            params: toolArgs,
                            description: reason,
                            risk: "medium",
                        } as any
                    }).returning();

                    slackBlocks = [
                        {
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: `⚠️ *Governed Action Approval Required*\n\n*Reason:* ${reason}\n*Tool:* \`${toolName}\`\n*Arguments:*\n\`\`\`${JSON.stringify(toolArgs, null, 2)}\`\`\``
                            }
                        },
                        {
                            type: "actions",
                            elements: [
                                {
                                    type: "button",
                                    text: { type: "plain_text", text: "Approve" },
                                    style: "primary",
                                    action_id: `molt:approve:${missionRunId}`,
                                    value: inserted.id.toString()
                                },
                                {
                                    type: "button",
                                    text: { type: "plain_text", text: "Reject" },
                                    style: "danger",
                                    action_id: `molt:reject:${missionRunId}`,
                                    value: inserted.id.toString()
                                }
                            ]
                        }
                    ];
                }
            } catch (e) {
                logger.error("[ConversationalBridge] Failed to parse approval_request JSON", e);
            }
        } else if (cleanResponse && cleanResponse.includes("mission_proposal")) {
            // Propose-and-approve: the agent proposed launching a mission (via the
            // propose_mission tool, which already persisted the proposal). Render
            // approve/reject buttons and show the user the friendly message.
            try {
                const match = cleanResponse.match(/\{"type":\s*"mission_proposal".*?\}/s);
                if (match) {
                    const req = JSON.parse(match[0]);
                    const proposalId = req.proposalId;
                    const missionName = req.missionName || `Mission ${req.missionId}`;
                    const reason = req.reason || "Requested via chat";
                    cleanResponse = req.message || `Proposal to launch "${missionName}" — approval required.`;
                    slackBlocks = [
                        {
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: `🚀 *Mission Launch Proposal*\n\n*Mission:* ${missionName}\n*Why:* ${reason}\n\n*Approve to launch it.*`,
                            },
                        },
                        {
                            type: "actions",
                            elements: [
                                {
                                    type: "button",
                                    text: { type: "plain_text", text: "Approve & Launch" },
                                    style: "primary",
                                    action_id: `proposal:approve:${proposalId}`,
                                    value: String(proposalId),
                                },
                                {
                                    type: "button",
                                    text: { type: "plain_text", text: "Reject" },
                                    style: "danger",
                                    action_id: `proposal:reject:${proposalId}`,
                                    value: String(proposalId),
                                },
                            ],
                        },
                    ];
                }
            } catch (e) {
                logger.error("[ConversationalBridge] Failed to parse mission_proposal JSON", e);
            }
        } else if (cleanResponse && cleanResponse.includes("mission_synthesis_proposal")) {
            // Propose-and-approve for GMS synthesis: no existing mission fit, so the
            // agent proposed synthesizing a new one. Render approve/reject buttons.
            try {
                const match = cleanResponse.match(/\{"type":\s*"mission_synthesis_proposal".*?\}/s);
                if (match) {
                    const req = JSON.parse(match[0]);
                    const proposalId = req.proposalId;
                    const request = req.request || "the requested capability";
                    cleanResponse = req.message || `I can synthesize a new mission for: "${request}". Approval required.`;
                    slackBlocks = [
                        {
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: `🧪 *New Mission Synthesis Proposal*\n\n*Goal:* ${request}\n*Why:* ${req.reason || "No existing mission fits."}\n\n*Approve to synthesize a new mission (saved as a draft for review).*`,
                            },
                        },
                        {
                            type: "actions",
                            elements: [
                                {
                                    type: "button",
                                    text: { type: "plain_text", text: "Approve & Synthesize" },
                                    style: "primary",
                                    action_id: `proposal:approve:${proposalId}`,
                                    value: String(proposalId),
                                },
                                {
                                    type: "button",
                                    text: { type: "plain_text", text: "Reject" },
                                    style: "danger",
                                    action_id: `proposal:reject:${proposalId}`,
                                    value: String(proposalId),
                                },
                            ],
                        },
                    ];
                }
            } catch (e) {
                logger.error("[ConversationalBridge] Failed to parse mission_synthesis_proposal JSON", e);
            }
        } else if (cleanResponse && cleanResponse.includes("escalation_request")) {
            try {
                const match = cleanResponse.match(/\{"type":\s*"escalation_request".*?\}/s);
                if (match) {
                    const request = JSON.parse(match[0]);
                    const reason = request.reason || "Agent has requested human steering";
                    const missionRunId = request.missionRunId || request.runId || 0;

                    slackBlocks = [
                        {
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: `🚨 *Agent Escalation / Help Required*\n\n*Details:* ${reason}\n\n*Please steer the agent to guide it back on track.*`
                            }
                        },
                        {
                            type: "actions",
                            elements: [
                                {
                                    type: "button",
                                    text: { type: "plain_text", text: "Steer Agent" },
                                    style: "primary",
                                    action_id: `mission:steer:${missionRunId}`
                                }
                            ]
                        }
                    ];
                }
            } catch (e) {
                logger.error("[ConversationalBridge] Failed to parse escalation_request JSON", e);
            }
        } else if (cleanResponse && cleanResponse.includes("clarification_request")) {
            try {
                const match = cleanResponse.match(/\{"type":\s*"clarification_request".*?\}/s);
                if (match) {
                    const request = JSON.parse(match[0]);
                    const question = request.question || "Please select an option:";
                    const options: string[] = request.options || [];
                    const missionRunId = request.missionRunId || request.runId || 0;
                    cleanResponse = question; // strip the marker JSON from the user-facing text

                    if (missionRunId && options.length > 0) {
                        // Mission-run clarification: buttons resume the run with the chosen option.
                        slackBlocks = [
                            { type: "section", text: { type: "mrkdwn", text: `🙋 *Clarification needed*\n\n${question}` } },
                            {
                                type: "actions",
                                elements: options.map((opt: string) => ({
                                    type: "button",
                                    text: { type: "plain_text", text: opt },
                                    action_id: `mission:clarify:${missionRunId}`,
                                    value: opt,
                                })),
                            },
                        ];
                    } else {
                        // Conversational (pre-action) clarification — e.g. gathering a mission's
                        // required inputs before proposing. No run to resume, so ask and let the
                        // user reply in-thread; list any options as a readable prompt.
                        const optText = options.length > 0 ? `\n\n${options.map((o, i) => `${i + 1}. ${o}`).join("\n")}` : "";
                        slackBlocks = [
                            { type: "section", text: { type: "mrkdwn", text: `🙋 *Clarification needed*\n\n${question}${optText}` } },
                        ];
                    }
                }
            } catch (e) {
                logger.error("[ConversationalBridge] Failed to parse clarification_request JSON", e);
            }
        } else if (cleanResponse && cleanResponse.includes("snooze_request")) {
            try {
                const match = cleanResponse.match(/\{"type":\s*"snooze_request".*?\}/s);
                if (match) {
                    const request = JSON.parse(match[0]);
                    const reason = request.reason || "Agent execution requires a delay";
                    const missionRunId = request.missionRunId || request.runId || 0;

                    slackBlocks = [
                        {
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: `⏳ *Agent Snooze Requested*\n\n*Reason:* ${reason}\n\n*Would you like to pause execution?*`
                            }
                        },
                        {
                            type: "actions",
                            elements: [
                                {
                                    type: "button",
                                    text: { type: "plain_text", text: "Snooze 10m" },
                                    action_id: `mission:snooze:${missionRunId}:10`
                                },
                                {
                                    type: "button",
                                    text: { type: "plain_text", text: "Snooze 1h" },
                                    action_id: `mission:snooze:${missionRunId}:60`
                                },
                                {
                                    type: "button",
                                    text: { type: "plain_text", text: "Resume Now" },
                                    style: "primary",
                                    action_id: `mission:approve:${missionRunId}`
                                }
                            ]
                        }
                    ];
                }
            } catch (e) {
                logger.error("[ConversationalBridge] Failed to parse snooze_request JSON", e);
            }
        } else if (cleanResponse && cleanResponse.includes("verification_request")) {
            try {
                const match = cleanResponse.match(/\{"type":\s*"verification_request".*?\}/s);
                if (match) {
                    const request = JSON.parse(match[0]);
                    const reason = request.reason || "Governed action requires a 2FA OTP verification code";
                    const missionRunId = request.missionRunId || request.runId || 0;

                    slackBlocks = [
                        {
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: `🔒 *Security Verification Challenge*\n\n*Reason:* ${reason}\n\n*Please submit your One-Time Passcode (OTP) to proceed.*`
                            }
                        },
                        {
                            type: "actions",
                            elements: [
                                {
                                    type: "button",
                                    text: { type: "plain_text", text: "Enter 2FA Code" },
                                    style: "primary",
                                    action_id: `mission:otp_modal:${missionRunId}`
                                }
                            ]
                        }
                    ];
                }
            } catch (e) {
                logger.error("[ConversationalBridge] Failed to parse verification_request JSON", e);
            }
        }

        // 8. Construct Premium Slack Response
        if (!slackBlocks) {
            const missionId = result.missionId || (result as any).runId;
            const statusEmoji = mode === 'planning' ? '📋' : '🚀';
            const modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1);
            
            slackBlocks = this.buildSlackTextSections(cleanResponse);

            // Add context footer
            const footerElements: any[] = [
                { type: "mrkdwn", text: `${statusEmoji} *${modeLabel} Mode*` }
            ];

            if (missionId) {
                footerElements.push({ type: "mrkdwn", text: ` | ?? *Mission:* <${process.env.APP_URL || 'http://localhost:5000'}/missions/${missionId}|#${missionId}>` });
            }

            slackBlocks.push({
                type: "context",
                elements: footerElements
            });

            // Add Action Buttons
            if (mode === 'planning' || missionId) {
                const actions: any[] = [];
                
                if (mode === 'planning') {
                    actions.push({
                        type: "button",
                        text: { type: "plain_text", text: "Approve & Execute" },
                        style: "primary",
                        action_id: "approve_execute_mode",
                        value: "execute"
                    });
                }

                if (missionId) {
                    actions.push({
                        type: "button",
                        text: { type: "plain_text", text: "View Details" },
                        url: `${process.env.APP_URL || 'http://localhost:5000'}/missions/${missionId}`,
                        action_id: `view_mission_btn_${missionId}`
                    });
                }

                if (actions.length > 0) {
                    slackBlocks.push({
                        type: "actions",
                        elements: actions
                    });
                }
            }
        }

        // 9. Dispatch final response
        await client.postMessage(message.channelId, cleanResponse, slackBlocks, message.threadTs);
    },

    normalizePlatformText(platform: InboundMessage["platform"], text: string = "") {
        if (platform !== 'slack') {
            return text.replace(/[ \t]+/g, ' ').trim();
        }

        return text
            .replace(/^(?:<@[A-Z0-9]+>\s*)+/, '')
            .replace(/[ \t]+/g, ' ')
            .trim();
    },

    buildSlackTextSections(text: string, maxSectionLength = 2800) {
        const source = (text || "_No response generated._").trim();
        const sections: any[] = [];
        let remaining = source;

        while (remaining.length > 0) {
            if (remaining.length <= maxSectionLength) {
                sections.push({
                    type: "section",
                    text: { type: "mrkdwn", text: remaining }
                });
                break;
            }

            let splitAt = remaining.lastIndexOf("\n\n", maxSectionLength);
            if (splitAt < Math.floor(maxSectionLength * 0.5)) {
                splitAt = remaining.lastIndexOf("\n", maxSectionLength);
            }
            if (splitAt < Math.floor(maxSectionLength * 0.5)) {
                splitAt = remaining.lastIndexOf(" ", maxSectionLength);
            }
            if (splitAt < 1) splitAt = maxSectionLength;

            sections.push({
                type: "section",
                text: { type: "mrkdwn", text: remaining.slice(0, splitAt).trim() }
            });
            remaining = remaining.slice(splitAt).trim();
        }

        return sections;
    },

    async tryHandleFastPath(message: InboundMessage, client: any, orgId: number) {
        if (message.platform !== 'slack') return false;

        const normalizedText = this.normalizePlatformText(message.platform, message.text).toLowerCase();
        if (!normalizedText) return false;

        if (normalizedText === 'planning mode' || normalizedText === 'switch to planning mode') {
            await this.setChatMode(message.channelId, 'planning');
            await client.postMessage(
                message.channelId,
                "Mode switched: Planning. I will describe the plan before acting. Say `execute mode` when you want direct action.",
                undefined,
                message.threadTs
            );
            return true;
        }

        if (normalizedText === 'execute mode' || normalizedText === 'switch to execute mode') {
            await this.setChatMode(message.channelId, 'execute');
            await client.postMessage(
                message.channelId,
                "Mode switched: Execute. I will perform actions directly when commanded.",
                undefined,
                message.threadTs
            );
            return true;
        }

        if (/^(help|oddjob help|commands|what commands do you support)(\s|[.!?]|$)/i.test(normalizedText)) {
            const mode = await this.getChatMode(message.channelId);
            const blocks = [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*Oddjob Assistant*\nCurrent mode: *${mode}*\n\nTry:\n- \`status\` for active mission health\n- \`planning mode\` for approval-first work\n- \`execute mode\` for direct action\n- \`daily brief\` for a short org summary\n- Ask naturally to create, inspect, repair, or run work`
                    }
                }
            ];
            await client.postMessage(message.channelId, "Oddjob Assistant help", blocks, message.threadTs);
            return true;
        }

        if (/^(daily brief|send daily brief|brief me)(\s|[.!?]|$)/i.test(normalizedText)) {
            await this.sendDailyBrief(message.channelId, orgId, client);
            return true;
        }

        if (/^(status|mission status|active missions|what'?s running|what is running|show active missions)(\s|[.!?]|$)/i.test(normalizedText)) {
            const runs = await db.select({
                id: missionRuns.id,
                name: missionRuns.name,
                status: missionRuns.status,
                updatedAt: missionRuns.updatedAt
            })
                .from(missionRuns)
                .where(and(
                    eq(missionRuns.organizationId, orgId),
                    sql`${missionRuns.status} IN ('active', 'paused', 'waiting_on_human', 'waiting_on_file')`
                ))
                .orderBy(desc(missionRuns.updatedAt))
                .limit(5);

            const appUrl = process.env.APP_URL || 'http://localhost:5000';
            const summary = runs.length
                ? runs.map((run: any) => `- <${appUrl}/missions/${run.id}|#${run.id}> *${run.name}* (${run.status})`).join('\n')
                : "_No active, paused, or waiting missions found._";

            const blocks = [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*Mission Status*\n${summary}`
                    }
                },
                {
                    type: "context",
                    elements: [{ type: "mrkdwn", text: `Requested by <@${message.userId}>` }]
                }
            ];

            await client.postMessage(message.channelId, "Mission status", blocks, message.threadTs);
            return true;
        }

        if (/^(ngrok|spinup ngrok|start ngrok|ngrok start|create tunnel|start tunnel|tunnel)(\s|[.!?]|$)/i.test(normalizedText)) {
            try {
                const url = await this.ensureNgrokTunnel(client, message.channelId, message.threadTs);
                const blocks = [
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: `🔗 *Oddjob Public Tunnel Ready!*\n\nYour local Oddjob instance is available via the public ngrok tunnel at:\n*${url}*\n\nEnjoy testing!`
                        }
                    }
                ];
                await client.postMessage(message.channelId, `Ngrok URL: ${url}`, blocks, message.threadTs);
            } catch (err: any) {
                await client.postMessage(message.channelId, `❌ *Failed to start ngrok:* ${err.message}`, undefined, message.threadTs);
            }
            return true;
        }

        if (/^(stop ngrok|kill ngrok|ngrok stop|ngrok kill|close tunnel|stop tunnel)(\s|[.!?]|$)/i.test(normalizedText)) {
            const stopped = await this.stopNgrokTunnel(client, message.channelId, message.threadTs);
            if (stopped) {
                await client.postMessage(message.channelId, "🛑 *Ngrok tunnel closed successfully.*", undefined, message.threadTs);
            } else {
                await client.postMessage(message.channelId, "⚠️ *No running ngrok instance was found to close.*", undefined, message.threadTs);
            }
            return true;
        }

        return false;
    },

    /**
     * Handle interactive actions from Slack (buttons, etc.)
     */
    async handleSlackAction(body: any) {
        const action = body.actions?.[0];
        if (!action) return;

        const channelId = body.channel?.id;
        const teamId = body.team?.id;
        const threadTs = body.container?.thread_ts || body.container?.message_ts;

        if (!channelId || !teamId) {
            logger.warn("[ConversationalBridge] handleSlackAction: missing channel or team in payload — ignoring");
            return;
        }

        logger.info(`[ConversationalBridge] Handling Slack action: ${action.action_id} for user ${body.user?.id}`);

        if (action.action_id === "approve_execute_mode") {
            // 1. Update Mode in Redis (24h TTL)
            await redis.set(`slack_mode:${channelId}`, 'execute', 'EX', 86400);
            logger.info(`[ConversationalBridge] Switched channel ${channelId} to EXECUTE mode via button.`);

            // 2. Resolve Connector & Notify
            const connector = await this.resolveConnector({ platform: 'slack', teamId, channelId } as any);
            if (connector) {
                const client = await this.getPlatformClient(connector);
                await client.postMessage(channelId, "✅ *Execute Mode Activated.* I will now carry out the plan. Tell me to 'proceed' or 'go' if you are ready.", undefined, threadTs);
            }
        } else if (action.action_id === "stay_planning_mode") {
            const connector = await this.resolveConnector({ platform: 'slack', teamId, channelId } as any);
            if (connector) {
                const client = await this.getPlatformClient(connector);
                await client.postMessage(channelId, "👍 Acknowledged. I will remain in *Planning Mode* until you're ready for action.", undefined, threadTs);
            }
        } else if (action.action_id?.startsWith("mission:approve:")) {
            const runId = parseInt(action.action_id.split(":")[2]);
            const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);
            if (run) {
                await missionRunService.resumeMissionRun(runId);
                const connector = await this.resolveConnector({ platform: 'slack', teamId, channelId } as any);
                if (connector) {
                    const client = await this.getPlatformClient(connector);
                    await client.postMessage(channelId, "✅ **Mission Approved:** Proceeding with the current plan...", undefined, threadTs);
                }
            }
        } else if (action.action_id?.startsWith("mission:reject:")) {
            const runId = parseInt(action.action_id.split(":")[2]);
            await missionRunService.update(runId, { status: "failed", missionContext: sql`mission_context || '{"failure_reason": "Stopped by user via Slack"}'::jsonb` });
            const connector = await this.resolveConnector({ platform: 'slack', teamId, channelId } as any);
            if (connector) {
                const client = await this.getPlatformClient(connector);
                await client.postMessage(channelId, "🛑 **Mission Stopped:** I have terminated the mission as requested.", undefined, threadTs);
            }
        } else if (action.action_id?.startsWith("proposal:approve:")) {
            const proposalId = parseInt(action.action_id.split(":")[2]);
            const { missionProposalService } = await import("@domain/mission/core/mission-proposal.service.js");
            const result = await missionProposalService.resolve(proposalId, "approved", body.user?.id || "slack-user");
            const connector = await this.resolveConnector({ platform: 'slack', teamId, channelId } as any);
            if (connector) {
                const client = await this.getPlatformClient(connector);
                let msg: string;
                if (result.status === "approved" && result.kind === "mission_synthesis") {
                    msg = result.synthesizedMissionId
                        ? `✅ *Synthesized a new draft mission "${result.missionName}"* (id ${result.synthesizedMissionId}${typeof result.score === "number" ? `, est. success ${(result.score * 100).toFixed(0)}%` : ""}). Review it, then ask me to launch it.`
                        : `⚠️ Synthesis approved but produced no mission: ${result.error ?? "unknown error"}`;
                } else if (result.status === "approved" && result.missionRunId) {
                    msg = `✅ *Approved — launching "${result.missionName}".* Run #${result.missionRunId} is now planning tasks.`;
                } else if (result.status === "approved" && result.error) {
                    msg = `⚠️ Approved, but it failed: ${result.error}`;
                } else if (result.status === "not_found") {
                    msg = `This proposal no longer exists.`;
                } else {
                    msg = `This proposal was already ${result.status}.`;
                }
                await client.postMessage(channelId, msg, undefined, threadTs);
            }
        } else if (action.action_id?.startsWith("proposal:reject:")) {
            const proposalId = parseInt(action.action_id.split(":")[2]);
            const { missionProposalService } = await import("@domain/mission/core/mission-proposal.service.js");
            const result = await missionProposalService.resolve(proposalId, "rejected", body.user?.id || "slack-user");
            const connector = await this.resolveConnector({ platform: 'slack', teamId, channelId } as any);
            if (connector) {
                const client = await this.getPlatformClient(connector);
                const msg = result.status === "rejected"
                    ? `🛑 *Rejected.* I won't launch "${result.missionName ?? "that mission"}".`
                    : result.status === "not_found"
                        ? `This proposal no longer exists.`
                        : `This proposal was already ${result.status}.`;
                await client.postMessage(channelId, msg, undefined, threadTs);
            }
        } else if (action.action_id?.startsWith("mission:steer:")) {
            const runId = parseInt(action.action_id.split(":")[2]);
            const connector = await this.resolveConnector({ platform: 'slack', teamId, channelId } as any);
            if (connector) {
                const client = await this.getPlatformClient(connector);
                // Open Slack Modal
                await (client as any).client.views.open({
                    trigger_id: body.trigger_id,
                    view: {
                        type: "modal",
                        callback_id: `mission_steer_modal:${runId}`,
                        title: { type: "plain_text", text: "Steer Mission" },
                        submit: { type: "plain_text", text: "Resume Mission" },
                        blocks: [
                            {
                                type: "input",
                                block_id: "steer_input",
                                label: { type: "plain_text", text: "Guidance / New Instructions" },
                                element: {
                                    type: "plain_text_input",
                                    action_id: "feedback",
                                    multiline: true,
                                    placeholder: { type: "plain_text", text: "e.g., Change the target domain to..." }
                                }
                            }
                        ]
                    }
                });
            }
        } else if (action.action_id?.startsWith("mission:clarify:")) {
            const parts = action.action_id.split(":");
            const runId = parseInt(parts[2]);
            const selectedOption = action.value;
            const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);
            if (run) {
                const currentContext = (run.missionContext as any) || {};
                await missionRunService.update(runId, { 
                    status: "active", 
                    missionContext: { 
                        ...currentContext, 
                        lastUserCommand: `Selected option: ${selectedOption}`,
                        phase: 'PLANNING' 
                    } 
                });
                
                // Resume mission execution
                const { scheduleMissionWave } = await import("@domain/mission/infrastructure/rolling-wave-queue.js");
                await scheduleMissionWave({ 
                    missionRunId: runId, 
                    userId: body.user.id, 
                    orgId: run.organizationId 
                });

                // Post confirmation reply
                const connector = await this.resolveConnector({ platform: 'slack', teamId: body.team.id, channelId } as any);
                if (connector) {
                    const client = await this.getPlatformClient(connector);
                    await client.postMessage(channelId, `🙋 **Option Selected:** \`${selectedOption}\`. Resuming execution...`, undefined, threadTs);
                }
            }
        } else if (action.action_id?.startsWith("mission:snooze:")) {
            const parts = action.action_id.split(":");
            const runId = parseInt(parts[2]);
            const minutes = parseInt(parts[3]);
            const snoozedUntil = new Date(Date.now() + minutes * 60 * 1000);
            
            const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);
            const currentContext = (run?.missionContext as any) || {};
            
            await missionRunService.update(runId, { 
                status: "paused", 
                missionContext: { 
                    ...currentContext, 
                    snoozedUntil: snoozedUntil.toISOString()
                } 
            });

            const connector = await this.resolveConnector({ platform: 'slack', teamId: body.team.id, channelId: currentContext.channelId } as any);
            if (connector) {
                const client = await this.getPlatformClient(connector);
                await client.postMessage(channelId, `⏳ **Snoozed:** Mission paused for ${minutes} minutes (until ${snoozedUntil.toLocaleTimeString()}).`, undefined, threadTs);
            }
        } else if (action.action_id?.startsWith("mission:otp_modal:")) {
            const runId = parseInt(action.action_id.split(":")[2]);
            const connector = await this.resolveConnector({ platform: 'slack', teamId: body.team.id, channelId } as any);
            if (connector) {
                const client = await this.getPlatformClient(connector);
                await (client as any).client.views.open({
                    trigger_id: body.trigger_id,
                    view: {
                        type: "modal",
                        callback_id: `mission_otp_modal:${runId}`,
                        title: { type: "plain_text", text: "Security Challenge" },
                        submit: { type: "plain_text", text: "Verify Code" },
                        blocks: [
                            {
                                type: "input",
                                block_id: "otp_block",
                                label: { type: "plain_text", text: "One-Time Passcode (OTP)" },
                                element: {
                                    type: "plain_text_input",
                                    action_id: "otp_code",
                                    placeholder: { type: "plain_text", text: "Enter 6-digit code" }
                                }
                            }
                        ]
                    }
                });
            }
        }

        // Handle Modal Submissions (view_submission)
        if (body.type === "view_submission" && body.view?.callback_id?.startsWith("mission_steer_modal:")) {
            const runId = parseInt(body.view.callback_id.split(":")[1]);
            const feedback = body.view.state.values.steer_input.feedback.value;
            const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);
            
            if (run) {
                const currentContext = (run.missionContext as any) || {};
                await missionRunService.update(runId, { 
                    status: "active", 
                    missionContext: { 
                        ...currentContext, 
                        lastUserCommand: feedback,
                        phase: 'PLANNING' 
                    } 
                });
                
                // Resume mission execution
                const { scheduleMissionWave } = await import("@domain/mission/infrastructure/rolling-wave-queue.js");
                await scheduleMissionWave({ 
                    missionRunId: runId, 
                    userId: body.user.id, 
                    orgId: run.organizationId 
                });

                // Notify in thread
                const connector = await this.resolveConnector({ platform: 'slack', teamId: body.team.id, channelId: currentContext.channelId } as any);
                if (connector) {
                    const client = await this.getPlatformClient(connector);
                    await client.postMessage(currentContext.channelId, `?? **Guidance Received:** Resuming mission with instructions: \n> ${feedback}`, undefined, currentContext.threadTs);
                }
            }
        } else if (body.type === "view_submission" && body.view?.callback_id?.startsWith("mission_otp_modal:")) {
            const runId = parseInt(body.view.callback_id.split(":")[1]);
            const otpCodeValue = body.view.state.values.otp_block.otp_code.value;
            const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);

            if (run) {
                const currentContext = (run.missionContext as any) || {};
                const connector = await this.resolveConnector({ platform: 'slack', teamId: body.team.id, channelId: currentContext.channelId } as any);
                if (connector) {
                    const client = await this.getPlatformClient(connector);
                    const user = await this.resolveUser({ platform: 'slack', userId: body.user.id } as any, client, run.organizationId || 0);
                    const email = user?.email || "";

                    const { otpCodes } = await import("@shared/schema/index.js");
                    const [otpRecord] = await db.select()
                        .from(otpCodes)
                        .where(and(
                            eq(otpCodes.executionId, runId.toString()),
                            eq(otpCodes.email, email),
                            eq(otpCodes.code, otpCodeValue),
                            sql`${otpCodes.usedAt} IS NULL`
                        ));

                    if (otpRecord) {
                        // Mark OTP as used
                        await db.update(otpCodes).set({ usedAt: new Date() }).where(eq(otpCodes.id, otpRecord.id));

                        // Resume execution
                        await missionRunService.update(runId, { 
                            status: "active", 
                            missionContext: { 
                                ...currentContext, 
                                lastUserCommand: "Verification challenge passed successfully.",
                                phase: 'PLANNING' 
                            } 
                        });
                        
                        const { scheduleMissionWave } = await import("@domain/mission/infrastructure/rolling-wave-queue.js");
                        await scheduleMissionWave({ 
                            missionRunId: runId, 
                            userId: body.user.id, 
                            orgId: run.organizationId 
                        });

                        await client.postMessage(currentContext.channelId, `✅ **Verification Challenge Passed:** Resuming agent run.`, undefined, currentContext.threadTs);
                    } else {
                        await client.postMessage(currentContext.channelId, `❌ **Verification Failed:** Invalid or expired 2FA passcode.`, undefined, currentContext.threadTs);
                    }
                }
            }
        }
    },

    async getChatMode(channelId: string): Promise<"planning" | "execute"> {
        try {
            const mode = await redis.get(`slack_mode:${channelId}`);
            return (mode as "planning" | "execute") || "planning";
        } catch {
            return "planning";
        }
    },

    async setChatMode(channelId: string, mode: "planning" | "execute") {
        try {
            await redis.set(`slack_mode:${channelId}`, mode, 'EX', 60 * 60 * 24); // 24 hour TTL
        } catch (err) {
            logger.error(`[ConversationalBridge] Failed to set mode in Redis: ${err}`);
        }
    },

    async getUserContext(userId: string, orgId: number) {
        if (userId === 'system') {
            return { 
                userId: 'system',
                isAdmin: false, 
                isSuperAdmin: false, 
                isOrgAdmin: false,
                organizationId: orgId,
                permissions: [] 
            };
        }

        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        const [role] = await db.select().from(adminRoles).where(eq(adminRoles.userId, userId)).limit(1);

        return {
            ...user,
            userId: user?.id || userId,
            isAdmin: !!role,
            isSuperAdmin: role?.role === 'super_admin',
            isOrgAdmin: role?.role === 'org_admin',
            organizationId: orgId,
            permissions: []
        };
    },

    /**
     * Handle file attachments for a mission
     */
    async handleAttachments(missionId: number, files: any[], client: any, orgId: number, userId: string, topicNames?: string[]) {
        logger.info(`[ConversationalBridge] Processing ${files.length} attachments for mission ${missionId}${topicNames?.length ? ` with topics: ${topicNames.join(', ')}` : ''}`);
        const { knowledgeNodes } = await import("@shared/schema/index.js");
        const { documentService } = await import("@domain/knowledge/core/extraction/document-service.js");
        
        for (const file of files) {
            try {
                const buffer = await (client as any).downloadFile(file.url_private);
                const { FileParser } = await import("@domain/core/infrastructure/file-parser.service.js");
                const parsed = await FileParser.parse(buffer, file.mimetype, file.name);
                
                // 1. Store as knowledge node for mission context
                await db.insert(knowledgeNodes).values({
                    organizationId: orgId,
                    label: 'Document',
                    name: file.name,
                    data: {
                        source: 'slack',
                        mimetype: file.mimetype,
                        size: file.size,
                        summary: parsed.summary,
                        content: parsed.content
                    },
                    missionId,
                    createdBy: userId
                });
                
                // 2. Store as knowledge document with topics for discoverability
                if (parsed.content || parsed.summary) {
                    try {
                        await documentService.createDocument({
                            title: file.name,
                            summary: parsed.summary || `Slack attachment from ${file.name}`,
                            sourceType: 'slack_attachment',
                            textContent: parsed.content,
                            contentType: file.mimetype,
                            fileSize: file.size,
                            metadata: {
                                source: 'slack',
                                missionId,
                                originalFilename: file.name,
                                mimetype: file.mimetype,
                                keywords: topicNames || []
                            },
                            topicNames: topicNames // Pass extracted hashtags as topics
                        }, { ...getSystemOrgContext(orgId), userId });
                        
                        logger.info(`[ConversationalBridge] Created knowledge document for ${file.name} with topics: ${topicNames?.join(', ') || 'none'}`);
                    } catch (docErr: any) {
                        logger.warn(`[ConversationalBridge] Failed to create knowledge document for ${file.name}: ${docErr.message}`);
                        // Non-blocking - knowledge node was still created
                    }
                }
                
                logger.info(`[ConversationalBridge] Attached file ${file.name} to mission ${missionId}`);
            } catch (err: any) {
                logger.error(`[ConversationalBridge] Failed to handle attachment ${file.name}: ${err.message}`);
            }
        }
    },

    // analyzeIntent was removed to satisfy unification with Agent Service reasoning loop.


    async sendThinkingIndicator(client: any, message: InboundMessage) {
        // Slack doesn't have a built-in "thinking" bubble like Teams, so we post a tiny ephemeral or a reaction
        try {
            // Slack specific
            if (message.platform === 'slack' && (client as any).client) {
                await (client as any).client.reactions.add({
                    channel: message.channelId,
                    timestamp: message.threadTs || message.timestamp,
                    name: "robot_face"
                });
            }
        } catch (err: any) {
            // Reactions are non-critical - log at trace level
            logger.debug(`[ConversationalBridge] Failed to add thinking indicator: ${err.message}`);
        }
    },

    async resolveConnector(message: InboundMessage) {
        // Multi-tenant resolution using teamId (Slack) or org specific metadata
        if (message.platform === 'slack' && message.teamId) {
            // The team id lives in config: credentials are encrypted and cannot
            // be queried. The Slack OAuth adapter writes `teamId`; older rows
            // and the sealing sweep may have `team_id`.
            const [fallbackConnector] = await db.select()
                .from(saasConnectors)
                .where(and(
                    eq(saasConnectors.platform, 'slack'),
                    sql`(config->>'teamId' = ${message.teamId} OR config->>'team_id' = ${message.teamId})`,
                    sql`${saasConnectors.status} IN ('active', 'connected')`
                ))
                .limit(1);
            
            if (fallbackConnector) return fallbackConnector;
        }

        // SMS has no saas_connectors row — the pairing lives in
        // omnichannel_identities instead. Resolve the verified identity by the
        // sender's number (channelId) and synthesize a connector-shaped object
        // exposing exactly the fields the bridge reads downstream
        // (id, platform, orgId, credentials, config).
        if (message.platform === 'sms') {
            const { omnichannelService } = await import("./core/omnichannel.service.js");
            const identity = await omnichannelService.resolveVerifiedIdentity('sms', message.channelId);
            if (!identity) return null;
            return {
                id: 0,
                platform: 'sms',
                orgId: identity.organizationId,
                credentials: {},
                config: {},
            };
        }

        // Global Fallback (Legacy / Single Tenant mode)
        const [connector] = await db.select()
            .from(saasConnectors)
            .where(and(
                eq(saasConnectors.platform, message.platform),
                sql`${saasConnectors.status} IN ('active', 'connected')`
            ))
            .limit(1);
        
        return connector;
    },

    async resolveUser(message: InboundMessage, client: any, orgId: number) {
        // SMS pairings are already verified: the inbound webhook puts the
        // Oddjob users.id (not a platform id) on message.userId, so the
        // user_platform_identities lookup below would never match.
        if (message.platform === 'sms') {
            const [user] = await db.select().from(users).where(eq(users.id, message.userId)).limit(1);
            return user || null;
        }

        const { userPlatformIdentities } = await import("@shared/schema/index.js");

        // 1. Try explicit identity mapping first (Production Grade)
        const [identity] = await db.select()
            .from(userPlatformIdentities)
            .where(and(
                eq(userPlatformIdentities.platform, message.platform),
                eq(userPlatformIdentities.platformUserId, message.userId),
                eq(userPlatformIdentities.organizationId, orgId)
            ))
            .limit(1);

        if (identity) {
            const [user] = await db.select().from(users).where(eq(users.id, identity.userId)).limit(1);
            if (user) return user;
        }

        // 2. Fallback: Try to match Slack User ID to Oddjob User via email
        if (message.platform === 'slack') {
            try {
                const slackUser = await (client as any).client.users.info({ user: message.userId });
                const email = slackUser.user?.profile?.email;
                
                if (email) {
                    const [foundUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);
                    if (foundUser) return foundUser;
                }
            } catch (err: any) {
                // Log at debug level - user lookup failure is expected for unlinked accounts
                logger.debug(`[ConversationalBridge] Email lookup failed for user ${message.userId}: ${err.message}`);
            }
        }

        return null;
    },

    async getPlatformClient(connector: any) {
        if (connector.platform === 'slack') {
            const envBotToken = process.env.SLACK_BOT_TOKEN;
            const token = (envBotToken && !envBotToken.includes('your-bot-token'))
                ? envBotToken
                : ((connector.credentials as any)?.bot_token || (connector.config as any)?.bot_token);
            if (!token) throw new Error("Connector missing bot_token");
            return await getSlackClient(token);
        }
        if (connector.platform === 'whatsapp') {
            return {
                postMessage: async (channelId: string, text: string) => {
                    logger.info(`[WhatsApp OUT] To: ${channelId}, Body: ${text}`);
                    const accountSid = process.env.TWILIO_ACCOUNT_SID;
                    const authToken = process.env.TWILIO_AUTH_TOKEN;
                    if (accountSid && authToken) {
                        try {
                            const twilioModule = await eval("import('twilio')");
                            const client = twilioModule.default(accountSid, authToken);
                            await client.messages.create({
                                body: text,
                                from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886'}`,
                                to: `whatsapp:${channelId}`
                            });
                        } catch (err: any) {
                            logger.error(`[WhatsApp OUT] Twilio delivery failed: ${err.message}`);
                        }
                    }
                }
            };
        }
        if (connector.platform === 'telegram') {
            return {
                postMessage: async (channelId: string, text: string) => {
                    logger.info(`[Telegram OUT] To: ${channelId}, Body: ${text}`);
                    const botToken = process.env.TELEGRAM_BOT_TOKEN;
                    if (botToken) {
                        try {
                            const axios = await import("axios");
                            await axios.default.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                                chat_id: channelId,
                                text: text
                            });
                        } catch (err: any) {
                            logger.error(`[Telegram OUT] API delivery failed: ${err.message}`);
                        }
                    }
                }
            };
        }
        if (connector.platform === 'sms') {
            return {
                postMessage: async (channelId: string, text: string) => {
                    // No body logging here — SMS replies can carry secrets
                    // (approvals, pairing codes) that must not land in logs.
                    const { omnichannelService } = await import("./core/omnichannel.service.js");
                    await omnichannelService.sendChannelMessage(
                        { channelType: 'sms', channelIdentifier: channelId, organizationId: connector.orgId },
                        text
                    );
                }
            };
        }
        throw new Error(`Unsupported platform: ${connector.platform}`);
    },

    /**
     * Synthesize and send a "Daily Strategic Brief" to a channel
     */
    async sendDailyBrief(channelId: string, orgId: number, platformClient?: any) {
        let client = platformClient;
        if (!client) {
            const connector = await this.resolveConnector({ platform: 'slack', orgId } as any);
            if (!connector) return;
            client = await this.getPlatformClient(connector);
        }

        // 1. Fetch recent knowledge additions (last 24h)
        const { knowledgeService } = await import("@domain/knowledge/core/knowledge.service.js");
        const { getSystemOrgContext } = await import("@server/utils/auth-context.js");
        const recentNodes = await knowledgeService.searchNodes(getSystemOrgContext(orgId), { limit: 5 });

        // 2. Fetch recent mission successes
        const recentMissions = await db.select()
            .from(missionRuns)
            .where(and(
                eq(missionRuns.organizationId, orgId),
                eq(missionRuns.status, 'completed'),
                gte(missionRuns.updatedAt, new Date(Date.now() - 86400000))
            ))
            .limit(3);

        // 3. Construct Blocks
        const blocks: any[] = [
            {
                type: "header",
                text: {
                    type: "plain_text",
                    text: "☀️ Oddjob Daily Strategic Brief",
                    emoji: true
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: "Here is your intelligence summary for the last 24 hours."
                }
            },
            { type: "divider" },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `?? *Knowledge Graph Expansion*\n${recentNodes.length > 0 ? recentNodes.map((n: any) => `• ${n.name} (\`${n.label}\`)`).join('\n') : "_No new nodes added today._"}`
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `🚀 *Mission Successes*\n${recentMissions.length > 0 ? recentMissions.map(m => `• Mission <${process.env.APP_URL || 'http://localhost:5000'}/missions/${m.id}|#${m.id}>: ${m.name}`).join('\n') : "_No missions completed in the last 24h._"}`
                }
            },
            { type: "divider" },
            {
                type: "context",
                elements: [
                    {
                        type: "mrkdwn",
                        text: "?? *Strategic Sentiment:* Stable | *Autonomous Pulse:* Nominal"
                    }
                ]
            }
        ];

        await client.postMessage(channelId, "?? **Oddjob Daily Strategic Brief**", blocks);
    },

    async ensureNgrokTunnel(client: any, channelId: string, threadTs?: string): Promise<string> {
        let url = await this.getNgrokUrl();
        if (url) {
            return url;
        }

        await client.postMessage(channelId, "⚡ Starting local ngrok tunnel for Oddjob...", undefined, threadTs);

        const { spawn } = await import("child_process");
        const args = ["http", "5000"];
        if (process.env.NGROK_STATIC_DOMAIN) {
            args.push("--domain", process.env.NGROK_STATIC_DOMAIN);
        }

        logger.info(`[Ngrok] Spawning ngrok with args: ${args.join(" ")}`);
        const ngrokProcess = spawn("ngrok", args, { shell: true, detached: true, stdio: "ignore" });
        ngrokProcess.unref();

        for (let i = 0; i < 5; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            url = await this.getNgrokUrl();
            if (url) {
                return url;
            }
        }

        throw new Error("ngrok failed to start or did not initialize tunnels in time.");
    },

    async stopNgrokTunnel(client: any, channelId: string, threadTs?: string): Promise<boolean> {
        const { exec } = await import("child_process");
        return new Promise((resolve) => {
            exec("taskkill /f /im ngrok.exe", (err, stdout, stderr) => {
                if (err) {
                    logger.warn("[Ngrok] taskkill failed (might not be running):", { error: err.message });
                    resolve(false);
                } else {
                    logger.info("[Ngrok] Successfully terminated ngrok process:", { stdout });
                    resolve(true);
                }
            });
        });
    },

    async getNgrokUrl(): Promise<string | null> {
        try {
            const fetch = (await import("node-fetch")).default;
            const res = await fetch("http://127.0.0.1:4040/api/tunnels");
            if (!res.ok) return null;
            const data: any = await res.json();
            const tunnel = data.tunnels?.find((t: any) => t.public_url && t.public_url.startsWith("https"));
            return tunnel ? tunnel.public_url : null;
        } catch {
            return null;
        }
    }
};
