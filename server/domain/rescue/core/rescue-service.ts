import { db } from "@server/database_service.js";
import { rescueSessions, rescueTelemetry, rescueEvents, type InsertRescueSession, type RescueSession } from "@shared/schema/rescue.js";
import { missionRuns, missions } from "@shared/schema/index.js";
import { eq, and, desc, ilike, or } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { missionRunService } from "../../mission/core/mission-run.service.js";
import { eventStream } from "../../core/infrastructure/event-stream.service.js";
import { missionSimulator } from "./rescue-simulator.js";
import { createHash, randomBytes, randomInt } from "crypto";

import { apps, appDeployments, appRecords } from "@shared/schema/apps.js";
import { licenseService } from "../../core/licensing/license-service.js";
import { ForbiddenError, LicenseRequiredError } from "@server/utils/errors.js";
import { missionEventBus, MissionEvent } from "../../mission/core/mission-event-bus.js";
import { assertRescueTransition, type CompletionEvidence } from "./dispatch-policy.js";

const logger = createLogger("RescueService");

export const rescueService = {
    /**
     * Log a forensic event for a rescue session.
     */
    async logRescueEvent(params: {
        sessionId: number;
        eventType: string;
        previousStatus?: string;
        newStatus?: string;
        actorId?: string;
        actorType: 'system' | 'provider' | 'user';
        details?: any;
    }, tx?: any): Promise<void> {
        try {
            const dbClient = tx || db;
            // 1. Get previous event for hashing chain
            const [lastEvent] = await dbClient.select()
                .from(rescueEvents)
                .where(eq(rescueEvents.sessionId, params.sessionId))
                .orderBy(desc(rescueEvents.createdAt))
                .limit(1);

            const previousHash = lastEvent?.eventHash || "ROOT";
            const timestamp = new Date().toISOString();

            // 2. Create forensic hash
            const hashInput = `${params.sessionId}|${params.eventType}|${params.newStatus || ''}|${timestamp}|${previousHash}`;
            const eventHash = createHash('sha256').update(hashInput).digest('hex');

            // 3. Insert immutable record
            await dbClient.insert(rescueEvents).values({
                sessionId: params.sessionId,
                eventType: params.eventType,
                previousStatus: params.previousStatus || null,
                newStatus: params.newStatus || null,
                actorId: params.actorId || "system",
                actorType: params.actorType,
                details: params.details || {},
                eventHash,
                previousEventHash: previousHash,
                createdAt: new Date()
            });

            // 4. Publish to global Event Stream for real-time subscribers
            eventStream.publish(
                `rescue.${params.eventType.toLowerCase()}`,
                {
                    sessionId: params.sessionId,
                    previousStatus: params.previousStatus,
                    newStatus: params.newStatus,
                    actorId: params.actorId,
                    actorType: params.actorType,
                    details: params.details
                },
                { sessionId: params.sessionId },
                "rescue-service"
            ).catch(err => logger.error("Failed to publish rescue event to stream", err));

            logger.debug(`Forensic event logged for session ${params.sessionId}: ${params.eventType}`);
        } catch (err) {
            logger.error(`Failed to log forensic event for session ${params.sessionId}`, { error: err });
        }
    },

    /**
     * Start a rescue session linked to a mission run.
     */
    async initiateRescue(params: {
        missionId?: number;
        missionRunId?: number;
        orgId?: number;
        serviceType: string;
        userLocation?: { lat: number; lng: number; address?: string; resolvedBy: 'gps' | 'map' | 'manual' };
        failureContext?: string;
        triageSummary?: string;
        status?: RescueSession['status'];
        severity?: string;
        source?: string;
        isDemoMode?: boolean;
        metadata?: any;
        culpritNodeId?: number;
    }): Promise<RescueSession> {
        // 1. Entitlement Guard (Licensing)
        const hasEntitlement = await licenseService.checkFeatureAccess("rescue_module");
        if (!hasEntitlement && !params.isDemoMode) {
            throw new LicenseRequiredError("The Dispatch module is not enabled for your organization. Please upgrade your license.");
        }

        // 2. Master Toggle Guard (Deployment Status)
        //
        // The app ships under the slug "rescue-dispatch"; "service-dispatch" is the
        // legacy name and exists in no environment. Matching only the legacy slug
        // meant this lookup found nothing for every organization, so the guard
        // below threw "currently disabled" unconditionally and no rescue session
        // could ever be created — including with isDemoMode, which bypasses the
        // licence check above but not this one. syncToAppDataset further down this
        // file already accepts both slugs; this is the same set, kept in agreement.
        if (params.orgId) {
            const [deployment] = await db.select({
                status: appDeployments.status
            })
                .from(appDeployments)
                .innerJoin(apps, eq(appDeployments.appId, apps.id))
                .where(
                    and(
                        eq(appDeployments.organizationId, params.orgId),
                        or(
                            eq(apps.slug, "rescue-dispatch"),
                            eq(apps.slug, "service-dispatch")
                        )
                    )
                )
                .limit(1);

            if (!deployment || (deployment.status !== "active" && deployment.status !== "installed")) {
                throw new ForbiddenError("The Service Dispatch app is currently disabled for this organization.");
            }
        }

        const publicToken = randomBytes(32).toString('hex');

        const [session] = await db.insert(rescueSessions).values({
            missionId: params.missionId ?? null,
            missionRunId: params.missionRunId ?? null,
            organizationId: params.orgId ?? null,
            serviceType: params.serviceType,
            userLocation: params.userLocation ?? { lat: 0, lng: 0, resolvedBy: 'manual' },
            failureContext: params.failureContext ?? null,
            triageSummary: params.triageSummary ?? null,
            severity: params.severity ?? null,
            source: params.source ?? "manual",
            isDemoMode: params.isDemoMode ?? false,
            metadata: params.metadata ?? {},
            status: params.status ?? "REQUESTED",
            publicToken,
            culpritNodeId: params.culpritNodeId ?? null
        }).returning();

        logger.info(`Initiated dispatch session ${session.id} ${params.missionRunId ? `for mission run ${params.missionRunId}` : '(orphaned)'}`);

        // Trigger Triage Generation for mission-linked rescues (Rescue 2.0)
        if (params.missionRunId) {
            this.generateTriageOptions(session.id).catch(err => {
                logger.error(`Failed to generate triage options for session ${session.id}:`, err);
            });
        }

        // Forensic Log
        await this.logRescueEvent({
            sessionId: session.id,
            eventType: "SESSION_INITIATED",
            newStatus: "REQUESTED",
            actorType: "system",
            details: { userLocation: params.userLocation, serviceType: params.serviceType }
        });

        // Update mission blackboard/context if mission exists
        if (params.missionRunId && params.missionId) {
            await missionRunService.checkpoint({
                missionRunId: params.missionRunId,
                missionId: params.missionId,
                missionContext: {
                    rescue_session_id: session.id,
                    rescue_status: "REQUESTED",
                    user_loc: params.userLocation
                },
                reason: "Rescue session initiated",
                changedBy: "system"
            });
        }

        if (params.isDemoMode) {
            missionSimulator.simulateFullLifecycle(session.id).catch(err => {
                logger.error(`Simulation failed for session ${session.id}:`, err);
            });
        }

        // ─── AUTO-PROVIDER ASSIGNMENT ───────────────────────────────────────
        // Fire-and-forget: find the nearest available provider and assign them.
        // Runs in background so initiateRescue returns immediately.
        if (!params.isDemoMode && params.userLocation && params.userLocation.lat && params.userLocation.lng) {
            this.attemptAutoAssignment(session.id, params.userLocation).catch(err => {
                logger.warn(`Auto-assignment failed for session ${session.id} (non-blocking): ${err.message}`);
            });
        }

        this.syncToAppDataset(session, params.metadata || {}).catch(err => {
            logger.warn(`syncToAppDataset failed for session ${session.id} (non-blocking): ${err.message}`);
        });

        // Trigger autonomous CREW Incident War Room deliberation on Critical incidents
        (async () => {
            try {
                const { crewOrchestratorService } = await import("@domain/crew/core/crew-orchestrator.service.js");
                // `|| 291` ran this deliberation inside TECHHEAD7 whenever a
                // session had no organization, posting another tenant's incident
                // details - address, asset serial, contract status - into their
                // crew room. A war room with no organization to hold it does not
                // run.
                const orgId = session.organizationId;
                if (orgId == null) {
                    logger.warn(
                        `Rescue session ${session.id} has no organization; skipping the CREW war room rather than running it in a default org.`,
                    );
                    return;
                }
                const sessionKey = "crew-rescue-dispatch-war-room";
                const recordId = `RSC-${String(session.id).padStart(3, '0')}`;
                const userLoc = (session.userLocation as any) || {};
                await crewOrchestratorService.runRound({
                    orgId,
                    sessionKey,
                    message: `[ALERT] Incident ${recordId} initiated: "${session.serviceType}" at "${userLoc.address || '200 N Spring St'}". Asset Serial: "${(session.metadata as any)?.assetVerification?.serialNumber || 'GEN-8842-X'}". Maintenance Contract: "${(session.metadata as any)?.assetVerification?.status || 'Active'}". Tactical deliberation requested.`,
                    userId: "incident-engine",
                    userDisplayName: "Incident Telemetry Engine",
                });
                logger.info(`Autonomous CREW War Room deliberation completed for ${recordId}.`);
            } catch (crewErr: any) {
                logger.warn(`Autonomous CREW deliberation (non-blocking): ${crewErr.message}`);
            }
        })().catch(() => {});

        return session;
    },

    /**
     * Syncs a rescue session record to the active_rescues dataset collection in app_records,
     * ensuring the Operations Control tactical sector map (/app/rescue-dispatch) renders
     * real-time intake requests submitted by users.
     */
    async syncToAppDataset(session: RescueSession, extraData: Record<string, any> = {}) {
        try {
            const matchedApps = await db.select({ id: apps.id }).from(apps)
                .where(or(eq(apps.slug, "rescue-dispatch"), eq(apps.slug, "service-dispatch"), eq(apps.slug, "dispatcher")));
            const appIds = matchedApps.length ? Array.from(new Set([...matchedApps.map(a => a.id), 3, 824])) : [3, 824];

            const recordId = `RSC-${String(session.id).padStart(3, '0')}`;
            const userLoc = (session.userLocation as any) || {};
            const lat = Number(userLoc.lat ?? 34.0522);
            const lng = Number(userLoc.lng ?? -118.2437);
            const recordData = {
                id: recordId,
                target: extraData.target || extraData.details || session.serviceType || "Commercial Generator #4",
                priority: extraData.priority || session.severity || "Critical",
                status: session.status === "REQUESTED" || session.status === "ENROUTE" ? "In-Progress" : session.status,
                opened_at: session.createdAt ? new Date(session.createdAt).toISOString() : new Date().toISOString(),
                location: { lat, lng },
                address: extraData.address || userLoc.address || "200 N Spring St, Los Angeles, CA",
                serial_number: extraData.serialNumber || "GEN-8842-X",
                maintenance_status:
                    (extraData.assetVerification?.status as string | undefined)
                    ?? ((session.metadata as any)?.assetVerification?.status as string | undefined)
                    ?? "Active Maintenance Contract (Verified)",
                incident_type: extraData.incidentType || session.serviceType || "Emergency Rescue",
                details: extraData.details || "Overheating commercial generator site 4",
                providerId: extraData.providerId || "PRO-ALPHA",
                provider_name: extraData.providerName || "Apex Field Response",
                provider_eta_minutes: 4,
            };

            // Same reason as the war room above: `|| 291` wrote this incident
            // record into TECHHEAD7's app data when the session had no
            // organization of its own.
            if (session.organizationId == null) {
                logger.warn(
                    `Rescue session ${session.id} has no organization; skipping the app-dataset sync rather than writing to a default org.`,
                );
                return;
            }

            for (const appId of appIds) {
                await db.insert(appRecords).values({
                    appId,
                    orgId: session.organizationId,
                    collection: "active_rescues",
                    recordId,
                    data: recordData,
                }).onConflictDoUpdate({
                    target: [appRecords.appId, appRecords.orgId, appRecords.collection, appRecords.recordId],
                    set: { data: recordData, updatedAt: new Date() },
                });
            }

            // Real-Time Event Broadcast
            const { broadcastRescueEvent } = await import("../infrastructure/rescue-events.routes.js");
            broadcastRescueEvent({
                type: session.status === "REQUESTED" ? "rescue.created" : "rescue.updated",
                timestamp: new Date().toISOString(),
                data: recordData,
            });

            logger.info(`Synced rescue session ${session.id} to active_rescues dataset across appIds [${appIds.join(", ")}].`);
        } catch (err: any) {
            logger.warn(`Failed to sync rescue session to app dataset: ${err.message}`);
        }
    },

    /**
     * Attempt automatic provider assignment for a rescue session.
     * Queries the geospatial index for nearby helpers, then assigns the closest one.
     * If no providers are found within the initial radius, expands the search.
     */
    async attemptAutoAssignment(sessionId: number, userLocation: { lat: number; lng: number }): Promise<void> {
        const { rescueGeoService } = await import("./geo-service.js");

        // Progressive radius expansion: 5km → 15km → 30km
        const radiusSteps = [5, 15, 30];

        for (const radiusKm of radiusSteps) {
            const nearbyHelpers = await rescueGeoService.findNearbyHelpers(
                userLocation.lat,
                userLocation.lng,
                radiusKm,
                1 // Only need the closest one
            );

            if (nearbyHelpers.length > 0) {
                const closestHelperId = nearbyHelpers[0];
                // Provider name defaults to the helper ID — in production this would be enriched
                // from the helper dataset with their actual name/company.
                const providerName = `Provider ${closestHelperId.slice(0, 8)}`;

                logger.info(`Auto-assigning provider ${closestHelperId} to session ${sessionId} (found within ${radiusKm}km)`);
                await this.offerProvider(sessionId, closestHelperId, providerName, {
                    radiusKm,
                    method: "geospatial_proximity",
                    caveat: "Provider capacity and qualifications must be confirmed before acceptance",
                });

                // Log the auto-assignment event
                await this.logRescueEvent({
                    sessionId,
                    eventType: "AUTO_OFFER_CREATED",
                    actorType: "system",
                    details: {
                        providerId: closestHelperId,
                        radiusKm,
                        method: "geospatial_proximity",
                        requiresProviderAcceptance: true,
                    },
                });
                return;
            }
        }

        // No providers found in any radius — log and leave in REQUESTED state
        logger.info(`No providers found within 30km for session ${sessionId}. Session remains in REQUESTED state for manual assignment.`);
        await this.logRescueEvent({
            sessionId,
            eventType: "AUTO_ASSIGNMENT_FAILED",
            actorType: "system",
            details: { reason: "no_providers_in_range", maxRadiusKm: 30 },
        });
    },

    /**
     * Assign a provider to a session.
     */
    async offerProvider(sessionId: number, providerId: string, providerName: string, matchEvidence: Record<string, unknown> = {}): Promise<void> {
        await db.transaction(async (tx) => {
            const [oldSession] = await tx.select().from(rescueSessions).where(eq(rescueSessions.id, sessionId));

            if (!oldSession) {
                throw new Error(`Rescue session ${sessionId} not found`);
            }

            assertRescueTransition(oldSession.status, "OFFERED");
            const [session] = await tx.update(rescueSessions)
                .set({
                    providerId,
                    providerName,
                    status: "OFFERED",
                    updatedAt: new Date()
                })
                .where(eq(rescueSessions.id, sessionId))
                .returning();

            if (session) {
                // Forensic Log (Still uses main db for now as it's fire-and-forget, or tx if needed)
                await this.logRescueEvent({
                    sessionId,
                    eventType: "PROVIDER_OFFERED",
                    previousStatus: oldSession.status,
                    newStatus: "OFFERED",
                    actorType: "system",
                    actorId: providerId,
                    details: { providerName, matchEvidence }
                }, tx);

                if (session.missionRunId && session.missionId) {
                    await missionRunService.checkpoint({
                        missionRunId: session.missionRunId,
                        missionId: session.missionId,
                        missionContext: {
                            rescue_status: "OFFERED",
                            helper_identity: { id: providerId, name: providerName }
                        },
                        reason: `Dispatch offered to ${providerName}`,
                        changedBy: "system"
                    }, tx); // Pass transaction to checkpoint
                }
            }
        });
    },

    async acceptProviderOffer(sessionId: number, providerId: string): Promise<void> {
        await db.transaction(async (tx) => {
            const [oldSession] = await tx.select().from(rescueSessions).where(eq(rescueSessions.id, sessionId));
            if (!oldSession) throw new Error(`Rescue session ${sessionId} not found`);
            if (oldSession.providerId !== providerId) throw new Error("This dispatch offer belongs to another provider");
            assertRescueTransition(oldSession.status, "ACCEPTED");

            await tx.update(rescueSessions).set({
                status: "ACCEPTED",
                arrivalHandshakeHash: randomInt(1000, 10000).toString(),
                updatedAt: new Date(),
            }).where(eq(rescueSessions.id, sessionId));

            await this.logRescueEvent({
                sessionId,
                eventType: "PROVIDER_ACCEPTED",
                previousStatus: oldSession.status,
                newStatus: "ACCEPTED",
                actorType: "provider",
                actorId: providerId,
                details: { providerName: oldSession.providerName },
            }, tx);
        });
    },

    /** @deprecated Prefer offerProvider followed by acceptProviderOffer. */
    async assignProvider(sessionId: number, providerId: string, providerName: string): Promise<void> {
        await this.offerProvider(sessionId, providerId, providerName);
        await this.acceptProviderOffer(sessionId, providerId);
    },

    /**
     * Submit telemetry data to the "Black Box".
     * PRODUCTION HARDENING: Moved to Redis Streams to decouple high-frequency GPS writes.
     */
    async submitTelemetry(sessionId: number, telemetry: {
        entityType: 'provider' | 'user';
        entityId: string;
        lat: number;
        lng: number;
        accuracy?: number;
        heading?: number;
        speed?: number;
        clientTimestamp: Date;
    }): Promise<void> {
        const { getRedisClient } = await import("@domain/core/infrastructure/redis/redis-client.js");
        const redis = getRedisClient();

        try {
            await redis.xadd(
                'rescue:telemetry:stream',
                'MAXLEN', '~', '10000',
                '*',
                'sessionId', sessionId.toString(),
                'entityType', telemetry.entityType,
                'entityId', telemetry.entityId,
                'lat', telemetry.lat.toString(),
                'lng', telemetry.lng.toString(),
                'accuracy', (telemetry.accuracy ?? '').toString(),
                'heading', (telemetry.heading ?? '').toString(),
                'speed', (telemetry.speed ?? '').toString(),
                'clientTimestamp', telemetry.clientTimestamp.toISOString()
            );
        } catch (err) {
            logger.error(`[RescueService] Failed to buffer telemetry in Redis: ${err}`);

            // Critical Fallback: If Redis is down, we still need basic tracking
            await db.update(rescueSessions)
                .set({
                    providerLocation: telemetry.entityType === 'provider' ? { lat: telemetry.lat, lng: telemetry.lng } : undefined,
                    updatedAt: new Date()
                })
                .where(eq(rescueSessions.id, sessionId));
        }
    },
    /**
     * Update the status of a rescue session.
     */
    async updateStatus(
        sessionId: number,
        status: RescueSession['status'],
        context: {
            actorId?: string;
            actorType?: 'system' | 'provider' | 'user';
            reason?: string;
            completionEvidence?: CompletionEvidence;
            policyMode?: 'dispatch' | 'mission_recovery';
        } = {},
    ): Promise<void> {
        await db.transaction(async (tx) => {
            const [oldSession] = await tx.select().from(rescueSessions).where(eq(rescueSessions.id, sessionId));

            if (!oldSession) {
                throw new Error(`Rescue session ${sessionId} not found`);
            }

            if (context.policyMode !== 'mission_recovery') {
                assertRescueTransition(oldSession.status, status, {
                    completionEvidence: context.completionEvidence,
                    arrivalVerified: oldSession.arrivalProtocolVerified,
                });
            }
            const metadata = {
                ...((oldSession.metadata as Record<string, unknown>) || {}),
                ...(context.completionEvidence ? { completionEvidence: context.completionEvidence } : {}),
            };
            const [session] = await tx.update(rescueSessions)
                .set({
                    status,
                    metadata,
                    completedAt: status === "COMPLETED" ? new Date() : oldSession.completedAt,
                    updatedAt: new Date(),
                })
                .where(eq(rescueSessions.id, sessionId))
                .returning();

            if (session) {
                // Forensic Log
                await this.logRescueEvent({
                    sessionId,
                    eventType: "STATUS_CHANGE",
                    previousStatus: oldSession.status,
                    newStatus: status,
                    actorType: context.actorType || "system",
                    actorId: context.actorId,
                    details: {
                        reason: context.reason,
                        ...(context.completionEvidence ? { completionEvidence: context.completionEvidence } : {}),
                    },
                }, tx);

                if (session.missionRunId && session.missionId) {
                    await missionRunService.checkpoint({
                        missionRunId: session.missionRunId,
                        missionId: session.missionId,
                        missionContext: {
                            rescue_status: status
                        },
                        reason: `Status changed to ${status}`,
                        changedBy: "system"
                    }, tx);

                    // Emit to MissionEventBus so orchestrator listeners can react
                    missionEventBus.emit(MissionEvent.RESCUE_STATUS_CHANGED, {
                        missionRunId: session.missionRunId,
                        rescueSessionId: sessionId,
                        previousStatus: oldSession.status,
                        newStatus: status,
                    });
                }

                if (status === 'COMPLETED') {
                    try {
                        const { rescueKnowledgeBridge } = await import("./rescue-knowledge-bridge.js");
                        const result = await rescueKnowledgeBridge.captureSuccessPattern(sessionId);
                        if (result.success) {
                            logger.info(`[RescueService] Captured success pattern ${result.nodeId} to knowledge graph`);
                        }
                    } catch (err: any) {
                        logger.error(`[RescueService] Failed to capture knowledge pattern: ${err.message}`);
                    }
                }
            }
        });
    },

    /**
     * Cancel a rescue session (typically by the user).
     */
    async cancelRescue(sessionId: number, reason?: string): Promise<void> {
        await db.transaction(async (tx) => {
            const [oldSession] = await tx.select().from(rescueSessions).where(eq(rescueSessions.id, sessionId));
            if (!oldSession) return;

            await tx.update(rescueSessions)
                .set({ status: 'CANCELLED', updatedAt: new Date() })
                .where(eq(rescueSessions.id, sessionId));

            await this.logRescueEvent({
                sessionId,
                eventType: "RESCUE_CANCELLED",
                previousStatus: oldSession.status,
                newStatus: "CANCELLED",
                actorType: "user",
                details: { reason }
            }, tx);

            if (oldSession.missionRunId && oldSession.missionId) {
                try {
                    // Defensive check: Verify mission run exists before checkpointing
                    const runExists = await tx.select({ id: missionRuns.id })
                        .from(missionRuns)
                        .where(eq(missionRuns.id, oldSession.missionRunId))
                        .limit(1);

                    if (runExists.length > 0) {
                        await missionRunService.checkpoint({
                            missionRunId: oldSession.missionRunId,
                            missionId: oldSession.missionId,
                            missionContext: { rescue_status: "CANCELLED" },
                            reason: `Rescue cancelled by user: ${reason || 'No reason provided'}`,
                            changedBy: "user"
                        }, tx);
                    } else {
                        logger.warn(`Skipping mission run checkpoint: Mission Run ${oldSession.missionRunId} not found for rescue session ${sessionId}`);
                    }
                } catch (err: any) {
                    logger.error(`Failed to checkpoint mission run ${oldSession.missionRunId} during rescue cancellation: ${err.message}`);
                }
            }
        });
    },

    /**
     * Verify the arrival handshake.
     */
    async verifyHandshake(sessionId: number, code: string): Promise<boolean> {
        return await db.transaction(async (tx) => {
            const [session] = await tx.select().from(rescueSessions).where(eq(rescueSessions.id, sessionId));
            if (!session || !session.arrivalHandshakeHash) return false;

            const isValid = code === session.arrivalHandshakeHash;

            if (isValid) {
                // Forensic Log BEFORE status change to capture transition
                await this.logRescueEvent({
                    sessionId,
                    eventType: "VERIFICATION_SUCCESS",
                    previousStatus: session.status,
                    newStatus: "ASSISTING",
                    actorType: "provider",
                    details: { method: "pin_code" }
                }, tx);

                await tx.update(rescueSessions)
                    .set({
                        status: "ASSISTING",
                        arrivalProtocolVerified: true,
                        updatedAt: new Date()
                    })
                    .where(eq(rescueSessions.id, sessionId));

                if (session.missionRunId && session.missionId) {
                    try {
                        // Defensive check: Verify mission run exists
                        const runExists = await tx.select({ id: missionRuns.id })
                            .from(missionRuns)
                            .where(eq(missionRuns.id, session.missionRunId))
                            .limit(1);

                        if (runExists.length > 0) {
                            await missionRunService.checkpoint({
                                missionRunId: session.missionRunId,
                                missionId: session.missionId,
                                missionContext: {
                                    rescue_status: "ASSISTING",
                                    arrival_verified: true
                                },
                                reason: "Arrival protocol verified",
                                changedBy: "system"
                            }, tx);
                        }
                    } catch (err: any) {
                        logger.error(`Failed to checkpoint mission run ${session.missionRunId} during handshake verification: ${err.message}`);
                    }
                }
            } else {
                // Forensic Log Failure
                await this.logRescueEvent({
                    sessionId,
                    eventType: "VERIFICATION_FAILURE",
                    actorType: "provider",
                    details: { attemptedCode: code }
                }, tx);
            }
            return isValid;
        });
    },

    /**
     * Get session details for frontend polling.
     */
    async getSession(sessionId: number): Promise<RescueSession | null> {
        const [session] = await db.select().from(rescueSessions).where(eq(rescueSessions.id, sessionId));
        return session || null;
    },

    /**
     * Generate strategic triage options for a failed or stalled mission run.
     * (Rescue 2.0)
     */
    async generateTriageOptions(sessionId: number): Promise<void> {
        const [session] = await db.select().from(rescueSessions).where(eq(rescueSessions.id, sessionId));
        if (!session || !session.missionRunId) return;

        logger.info(`Generating triage options for session ${sessionId} (Mission Run ${session.missionRunId})`);

        // 1. Analyze failure context (in a real scenario, this would use an LLM or logic-based triage)
        // For now, we provide three standardized strategic options with simulated probabilities.

        const options = [
            {
                id: "manual_takeover_" + Date.now(),
                label: "Manual Takeover",
                description: "The agent will pause completely and wait for you to perform the next action via the Decision Inbox.",
                successProbability: 1.0,
                actionType: "manual_takeover"
            },
            {
                id: "relax_constraints_" + Date.now(),
                label: "Relax JIRA Constraints",
                description: "Temporarily bypass non-critical field validations to allow the sync to continue.",
                successProbability: 0.85,
                actionType: "relax_constraints",
                params: { bypassFields: ["priority", "label"] }
            },
            {
                id: "reroute_knowledge_" + Date.now(),
                label: "Reroute via Confluence",
                description: "The agent will attempt to find the missing field mapping in the Confluence documentation instead of JIRA.",
                successProbability: 0.65,
                actionType: "reroute_knowledge",
                params: { alternativeSource: "Confluence Arch-Guidance" }
            }
        ];

        const triageSummary = "The JIRA Sync mission is stalled due to a missing 'priority' field mapping. Manual intervention or alternative knowledge routing is recommended.";

        await db.update(rescueSessions)
            .set({
                recoveryOptions: options as any,
                triageSummary,
                updatedAt: new Date()
            })
            .where(eq(rescueSessions.id, sessionId));

        // Forensic Log
        await this.logRescueEvent({
            sessionId,
            eventType: "TRIAGE_GENERATED",
            actorType: "system",
            details: { optionCount: options.length, summary: triageSummary }
        });
    },

    /**
     * Apply a selected recovery option from a rescue session's triage list.
     * Routes each actionType to the appropriate system (governor, blackboard, etc.).
     */
    async applyRecoveryOption(sessionId: number, optionId: string, actorId?: string): Promise<{ success: boolean; message?: string; paused?: boolean; dismissed?: boolean }> {
        const [session] = await db.select().from(rescueSessions).where(eq(rescueSessions.id, sessionId)).limit(1);
        if (!session) return { success: false, message: "Session not found" };

        const options = (session.recoveryOptions as any[]) || [];
        const option = options.find((o: any) => o.id === optionId);
        if (!option) return { success: false, message: `Recovery option '${optionId}' not found` };

        logger.info(`[Rescue] Applying recovery option '${option.label}' (${option.actionType}) for session ${sessionId}`);

        try {
            // Actions that mutate a mission's blackboard require a linked run. An
            // orphaned session can't apply those, so fail (the handler below dismisses
            // it). Tool enrollment (approve_tool/reject_tool) is org-scoped — it
            // activates an MCP server, not a run — so it works without a mission run.
            const requiresRun = ["relax_constraints", "reroute_knowledge"];
            if (requiresRun.includes(option.actionType) && !session.missionRunId) {
                throw new Error(`Recovery option '${option.actionType}' requires a linked mission run, but session ${sessionId} has none.`);
            }

            switch (option.actionType) {
                case "approve_tool": {
                    // Enroll the capability by activating the matching MCP server for
                    // this org. The gap is an inactive MCP server (see
                    // discovery.request_mcp_tool), so this is org-scoped and works even
                    // for an orphaned session with no mission run.
                    const toolName = option.params?.toolName;
                    if (toolName) {
                        const { mcpServers } = await import("@shared/schema/index.js");
                        const activated = await db.update(mcpServers)
                            .set({ status: "active" })
                            .where(and(
                                session.organizationId != null ? eq(mcpServers.organizationId, session.organizationId) : undefined,
                                ilike(mcpServers.name, `%${toolName}%`),
                            ))
                            .returning({ id: mcpServers.id, name: mcpServers.name });
                        if (activated.length === 0) {
                            logger.warn(`[Rescue] approve_tool: no MCP server matching '${toolName}' for org ${session.organizationId} to activate`);
                        } else {
                            logger.info(`[Rescue] approve_tool: activated MCP server(s) ${activated.map(a => `${a.name}(#${a.id})`).join(", ")}`);
                        }
                    }
                    // If linked to a paused mission, resume it so it retries with the
                    // newly-enabled capability.
                    if (session.missionRunId) {
                        await missionRunService.resume(session.missionRunId).catch((e: any) =>
                            logger.warn(`[Rescue] approve_tool: failed to resume run ${session.missionRunId}: ${e.message}`));
                    }
                    break;
                }

                case "reject_tool": {
                    // Denial: leave the capability inactive. The decision is captured in
                    // the rescue event log below; the agent must pivot. No run required.
                    logger.info(`[Rescue] reject_tool: capability '${option.params?.toolName}' denied for session ${sessionId}`);
                    break;
                }

                case "relax_constraints": {
                    // Write relaxation params into mission blackboard
                    if (session.missionRunId && session.missionId) {
                        await missionRunService.checkpoint({
                            missionRunId: session.missionRunId,
                            missionId: session.missionId,
                            missionContext: { rescue_relaxed_constraints: option.params || {} },
                            reason: `Recovery option '${option.label}' applied`,
                            changedBy: actorId || "rescue-service",
                        });
                    }
                    break;
                }

                case "reroute_knowledge": {
                    if (session.missionRunId && session.missionId) {
                        await missionRunService.checkpoint({
                            missionRunId: session.missionRunId,
                            missionId: session.missionId,
                            missionContext: { rescue_alternative_source: option.params?.alternativeSource || null },
                            reason: `Knowledge reroute via '${option.params?.alternativeSource}'`,
                            changedBy: actorId || "rescue-service",
                        });
                    }
                    break;
                }

                case "manual_takeover":
                    // Status change to ASSISTING signals the human is taking over
                    await this.updateStatus(sessionId, "ASSISTING", {
                        actorId,
                        actorType: "user",
                        reason: "Human operator accepted manual mission recovery",
                        policyMode: "mission_recovery",
                    });
                    break;

                default:
                    logger.warn(`[Rescue] Unknown recovery action type: ${option.actionType}`);
                    break;
            }

            await this.logRescueEvent({
                sessionId,
                eventType: "RECOVERY_OPTION_APPLIED",
                actorId: actorId || "system",
                actorType: actorId ? "user" : "system",
                details: { optionId, actionType: option.actionType, label: option.label },
            });

            return { success: true };
        } catch (err: any) {
            logger.error(`[Rescue] Failed to apply recovery option '${optionId}': ${err.message}`);
            // A failed recovery must not leave the mission hanging or the request stuck.
            // Pause the mission (if this session is linked to a run) and dismiss the HIL
            // request — atomically, server-side, so it works even when the client can't.
            let paused = false;
            if (session.missionRunId) {
                try {
                    await missionRunService.pause(session.missionRunId);
                    paused = true;
                } catch (e: any) {
                    logger.warn(`[Rescue] Failed to pause mission run ${session.missionRunId}: ${e.message}`);
                }
            }
            try {
                await this.cancelRescue(sessionId, `Recovery failed: ${err.message}`);
            } catch (e: any) {
                logger.warn(`[Rescue] Failed to dismiss session ${sessionId}: ${e.message}`);
            }
            return { success: false, message: err.message, paused, dismissed: true };
        }
    },
};


