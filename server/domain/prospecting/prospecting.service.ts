import { db } from "@server/database_service.js";
import { prospectProfiles, prospectLeads, prospectProperties, scoringEvents, prospectEvents } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
// The HTTP-aware NotFoundError (statusCode 404). These six lookups were bare
// Errors, so the handler could only read them as 500s: a request for another
// org's property was denied — correctly — but reported as an internal fault,
// and each one filed an error_diagnoses row for a working boundary check.
import { NotFoundError } from "@server/utils/errors.js";
import { v4 as uuidv4 } from "uuid";
import { scoringService } from "./scoring.service.js";
import { toLegacyVector } from "@shared/contracts/score-vector.js";
import { mcpClientService } from "@domain/integrations/core/mcp-client.service.js";

import { parseAndValidateEventTimestamp } from "./timestamp-validator.js";

// Tool-name fragments that indicate an IP→company enrichment provider is connected.
const ENRICHMENT_FRAGMENTS = ["clearbit", "zoominfo", "enrich_ip", "reverse_ip", "ipinfo", "enrich"];

const logger = createLogger("ProspectingService");

interface ProcessEventPayload {
    propertyUid: string;
    prospectUid?: string;
    cookieUid?: string;
    activity: string;
    payload: any;
    themes?: string[];
    ipAddress?: string;
    url?: string;
    timestamp?: string | number | Date;
    eventTimestamp?: string | number | Date;
    clientTimestamp?: string | number | Date;
    occurredAt?: string | number | Date;
}

interface IdentifyPayload {
    propertyUid: string;
    prospectUid: string;
    userId: string;
    email?: string;
    metadata?: any;
}

export class ProspectingService {
    async enqueueBatchedEvents(events: any[], cookieUid?: string, ipAddress?: string) {
        if (!events || events.length === 0) return { count: 0 };

        const mainProspectUid = events[0].prospectUid;

        // Import queue service here to avoid circular dependency
        const { queueService } = await import("@domain/core/infrastructure/queue/queue-service.js");

        const jobsData = events.filter(e => e.propertyUid).map(event => {
            const rawTimestamp = event.timestamp
                ?? event.eventTimestamp
                ?? event.clientTimestamp
                ?? event.occurredAt
                ?? event.payload?.timestamp
                ?? event.payload?.eventTimestamp
                ?? event.payload?.clientTimestamp
                ?? event.payload?.occurredAt;

            return {
                propertyUid: event.propertyUid,
                prospectUid: event.prospectUid,
                cookieUid,
                activity: event.activity,
                payload: event.payload,
                themes: event.themes,
                ipAddress,
                timestamp: rawTimestamp,
            };
        });

        if (jobsData.length > 0) {
            await queueService.addBulkJobsWithTrace(queueService.prospectingQueue, "process-event", jobsData);
        }

        return { count: jobsData.length, mainProspectUid };
    }

    async processEvent(data: ProcessEventPayload) {
        const { propertyUid, prospectUid, cookieUid, activity, payload, themes } = data;

        // 1. Verify Property
        const [property] = await db.select().from(prospectProperties).where(eq(prospectProperties.uid, propertyUid));
        if (!property) {
            throw new NotFoundError("Property not found");
        }

        const organizationId = property.organizationId;

        // 2. Visitor Attribution
        let uid = prospectUid || cookieUid;
        let profile = null;

        if (uid) {
            [profile] = await db.select().from(prospectProfiles).where(
                and(
                    eq(prospectProfiles.organizationId, organizationId),
                    eq(prospectProfiles.uid, uid)
                )
            ).limit(1);
        }

        let cookieToSet = null;

        if (!profile) {
            uid = uid || `v_${uuidv4()}`;
            [profile] = await db.insert(prospectProfiles).values({
                organizationId,
                propertyId: property.id,
                uid,
                attributedThemes: themes || [],
                attributedConcepts: [],
            }).returning();

            if (!cookieUid) {
                cookieToSet = uid;
            }
        } else {
            // Update themes and last seen
            const existingThemes = profile.attributedThemes as string[];
            const newThemes = themes || [];
            const updatedThemes = Array.from(new Set([...existingThemes, ...newThemes]));

            await db.update(prospectProfiles).set({
                attributedThemes: updatedThemes,
                lastSeenAt: new Date(),
                updatedAt: new Date()
            }).where(eq(prospectProfiles.id, profile.id));
        }

        // 3. Resolve Lead State
        let [lead] = await db.select().from(prospectLeads).where(eq(prospectLeads.profileId, profile!.id));
        if (!lead) {
            [lead] = await db.insert(prospectLeads).values({
                organizationId,
                profileId: profile!.id,
                status: "anonymous",
            }).returning();
        }

        const rawTimestamp = data.timestamp
            ?? data.eventTimestamp
            ?? data.clientTimestamp
            ?? data.occurredAt
            ?? (payload as any)?.timestamp
            ?? (payload as any)?.eventTimestamp
            ?? (payload as any)?.clientTimestamp
            ?? (payload as any)?.occurredAt;
        const eventTimestamp = parseAndValidateEventTimestamp(rawTimestamp);

        // 3.5 Record Raw Event
        await db.insert(prospectEvents).values({
            organizationId,
            propertyId: property.id,
            profileId: profile!.id,
            sessionId: data.payload?.sessionId || 'unknown',
            activity,
            url: data.url || (payload as any)?.url || 'unknown',
            payload: payload || {},
            createdAt: eventTimestamp,
        });

        // 4. Scoring Logic integration
        await scoringService.evaluateEvent(profile!.id, organizationId, activity, payload, themes, eventTimestamp);
        const intervention = await scoringService.shouldIntervene(profile!.id, property);

        // 4.5 Cache intervention in Redis for polling delivery
        if (intervention) {
            try {
                const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
                const interventionKey = `prospect_intervention:${propertyUid}:${uid}`;
                await redis.set(interventionKey, JSON.stringify({
                    ...intervention,
                    createdAt: Date.now(),
                    propertyUid,
                    prospectUid: uid,
                }));
                // TTL: 5 minutes — interventions are time-sensitive
                await redis.expire(interventionKey, 300);
            } catch (redisErr: any) {
                // Non-blocking: if Redis is down, skip caching
                logger.warn("Failed to cache intervention in Redis", { error: redisErr?.message ?? String(redisErr) });
            }
        }

        // ==========================================
        // DE-ANONYMIZATION PHASE 
        // ==========================================

        if (data.ipAddress && !(profile?.metadata as any)?.company) {
            // Lazy load to prevent circular dependencies
            const { deAnonymizationService } = await import("./de-anonymization.service.js");

            // This is asynchronous and runs in the background queue seamlessly.
            // Honors the property's de-anonymization rules (provider chain, IP/ICP
            // filters, confidence, trigger) — null config = service defaults.
            await deAnonymizationService.resolveIp(data.ipAddress, profile!.id, organizationId, (property as any).deanonConfig);
        }

        return {
            uid,
            leadId: lead.id,
            themesAttributed: profile?.attributedThemes || [],
            intervention,
            cookieToSet
        };
    }

    async identify(data: IdentifyPayload) {
        const { propertyUid, prospectUid, userId, email, metadata } = data;

        const [property] = await db.select().from(prospectProperties).where(eq(prospectProperties.uid, propertyUid));
        if (!property) throw new NotFoundError("Property not found");

        return await db.transaction(async (tx) => {
            const [incomingProfile] = await tx.select().from(prospectProfiles).where(
                and(
                    eq(prospectProfiles.organizationId, property.organizationId),
                    eq(prospectProfiles.uid, prospectUid)
                )
            );

            if (!incomingProfile) throw new Error("Prospect profile not found");

            const [existingAuthProfile] = await tx.select().from(prospectProfiles).where(
                and(
                    eq(prospectProfiles.organizationId, property.organizationId),
                    eq(prospectProfiles.userId, userId)
                )
            );

            let masterUid = incomingProfile.uid;
            let merged = false;
            let previousUid: string | undefined = undefined;

            if (existingAuthProfile && existingAuthProfile.id !== incomingProfile.id) {
                merged = true;
                previousUid = incomingProfile.uid;
                const mergedThemes = Array.from(new Set([...(existingAuthProfile.attributedThemes as string[]), ...(incomingProfile.attributedThemes as string[])]));
                const mergedConcepts = Array.from(new Set([...(existingAuthProfile.attributedConcepts as string[]), ...(incomingProfile.attributedConcepts as string[])]));

                await tx.update(prospectProfiles)
                    .set({
                        attributedThemes: mergedThemes,
                        attributedConcepts: mergedConcepts,
                        metadata: { ...(existingAuthProfile.metadata as object || {}), ...(incomingProfile.metadata as object || {}), email, ...metadata },
                        updatedAt: new Date()
                    })
                    .where(eq(prospectProfiles.id, existingAuthProfile.id));

                const [incomingLead] = await tx.select().from(prospectLeads).where(eq(prospectLeads.profileId, incomingProfile.id));
                const [existingLead] = await tx.select().from(prospectLeads).where(eq(prospectLeads.profileId, existingAuthProfile.id));

                // TRANSFER HISTORICAL EVENTS to the authenticated profile
                await tx.update(prospectEvents)
                    .set({ profileId: existingAuthProfile.id })
                    .where(eq(prospectEvents.profileId, incomingProfile.id));

                // TRANSFER SCORING CONTRIBUTIONS. The decayed S.C.O.R.E. vector is
                // derived from scoring_events by prospect id, so leaving these behind
                // would strand every pre-identification contribution on a profile
                // that is about to be deleted — collapsing the score to zero at the
                // precise moment an anonymous visitor becomes known, which is the
                // most valuable moment in the funnel.
                await tx.update(scoringEvents)
                    .set({ prospectId: existingAuthProfile.id })
                    .where(eq(scoringEvents.prospectId, incomingProfile.id));

                if (incomingLead && existingLead) {
                    await tx.delete(prospectLeads).where(eq(prospectLeads.id, incomingLead.id));
                }

                if (existingLead) {
                    // Recompute from the now-merged contribution history rather than
                    // adding the two stored vectors together.
                    const decayedVector = await scoringService.computeDecayedVector(existingAuthProfile.id, new Date(), tx);
                    await tx.update(prospectLeads)
                        .set({ bantScore: toLegacyVector(decayedVector.values) as any, status: "identified", updatedAt: new Date() })
                        .where(eq(prospectLeads.id, existingLead.id));
                }

                await tx.delete(prospectProfiles).where(eq(prospectProfiles.id, incomingProfile.id));
                masterUid = existingAuthProfile.uid;
            } else {
                await tx.update(prospectProfiles)
                    .set({
                        userId,
                        metadata: { ...(incomingProfile.metadata as object || {}), email, ...metadata },
                        updatedAt: new Date()
                    })
                    .where(eq(prospectProfiles.id, incomingProfile.id));

                await tx.update(prospectLeads)
                    .set({ status: "identified", updatedAt: new Date() })
                    .where(eq(prospectLeads.profileId, incomingProfile.id));
            }

            // Transactional Outbox: Emit high-intent identity resolution signal to Kafka outbox
            try {
                const { enqueueKafkaEvent } = await import("@domain/core/infrastructure/kafka-outbox.service.js");
                const { SPATIAL_EVENT_TOPICS } = await import("@shared/contracts/spatial-events.js");
                const eventId = uuidv4();
                await enqueueKafkaEvent(tx, {
                    eventId,
                    eventType: SPATIAL_EVENT_TOPICS.signal,
                    type: "observation",
                    schemaVersion: 1,
                    occurredAt: new Date().toISOString(),
                    organizationId: property.organizationId,
                    producer: "identity-bridge",
                    correlationId: eventId,
                    subject: `prospect:${masterUid}`,
                    payload: {
                        signalId: `sig_identity_${masterUid}_${Date.now()}`,
                        eventType: "identity.resolved",
                        targetSector: "identity",
                        severity: "info",
                        confidence: 1.0,
                        jurisdiction: "global",
                        summary: `Identity Bridge resolved visitor to user ${userId} (${email || "no-email"})`,
                        entityRefs: [{ type: "prospect", id: masterUid }],
                        provenance: {
                            propertyUid,
                            userId,
                            email,
                            merged,
                            previousUid,
                        },
                    },
                });
            } catch (outboxErr) {
                logger.warn("Non-fatal: failed to enqueue Kafka outbox event for identity bridge", {
                    error: outboxErr instanceof Error ? outboxErr.message : String(outboxErr),
                });
            }

            return { masterUid };
        });
    }

    /**
     * Live AI co-pilot chat (P1 handoff). Resolves the property's persona agent and
     * the visitor's context (de-anon company, themes, intent score), then generates
     * a grounded reply. Stateless — the harness sends the running message history.
     */
    async copilotChat(data: { propertyUid: string; prospectUid: string; messages: Array<{ role: string; content: string }>; agentPrompt?: string }): Promise<{ reply: string }> {
        const [property] = await db.select().from(prospectProperties).where(eq(prospectProperties.uid, data.propertyUid));
        if (!property) throw new NotFoundError("Property not found");

        // Visitor grounding context (best-effort)
        let companyName = "";
        let themes: string[] = [];
        let totalScore = 0;
        try {
            const [profile] = await db.select().from(prospectProfiles).where(and(
                eq(prospectProfiles.organizationId, property.organizationId),
                eq(prospectProfiles.uid, data.prospectUid)
            )).limit(1);
            if (profile) {
                companyName = (profile.metadata as any)?.company?.name || "";
                themes = (profile.attributedThemes as string[]) || [];
                const [lead] = await db.select().from(prospectLeads).where(eq(prospectLeads.profileId, profile.id)).limit(1);
                if (lead) {
                    const s = (lead.bantScore as any) || {};
                    totalScore = Object.values(s).reduce((a: any, b: any) => Number(a) + Number(b), 0) as number;
                }
            }
        } catch { /* context is optional */ }

        const persona = property.personaPromptOverride && property.personaPromptOverride.trim()
            ? property.personaPromptOverride
            : `You are "${property.personaAgentId || 'Sales Pilot'}", an AI sales co-pilot for ${property.name || 'this website'}.`;

        const system = `${persona}\n` +
            (data.agentPrompt ? `Guidance for this visitor: ${data.agentPrompt}\n` : "") +
            `You are chatting live with a website visitor.` +
            (companyName ? ` They appear to be from ${companyName}.` : "") +
            (themes.length ? ` They have shown interest in: ${themes.join(", ")}.` : "") +
            ` Current intent score: ${totalScore}. ` +
            `Be concise, helpful, and human. Answer their questions and, when it fits, offer a demo or to connect them with a specialist. ` +
            `Never invent pricing, facts, or commitments you don't actually know.`;

        const convo = (data.messages || [])
            .filter(m => m && typeof m.content === "string" && m.content.trim())
            .slice(-12)
            .map(m => `${m.role === "user" ? "Visitor" : "Co-pilot"}: ${m.content}`)
            .join("\n");

        const prompt = `${system}\n\nConversation so far:\n${convo}\n\nCo-pilot:`;

        try {
            const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");
            const reply = await systemAiService.generateText(prompt, { serviceKey: "concierge" });
            return { reply: (reply || "").trim() || "Thanks for reaching out! How can I help you today?" };
        } catch (err: any) {
            logger.warn(`[Prospecting] Co-pilot chat generation failed: ${err.message}`);
            return { reply: "Thanks for reaching out! A specialist will follow up shortly." };
        }
    }

    /**
     * Whether an IP→company enrichment provider (Clearbit / ZoomInfo / reverse-IP
     * MCP tool) is connected. De-anonymization is a no-op without one, so the
     * dashboard surfaces this so operators know to connect a provider.
     */
    async getEnrichmentStatus(): Promise<{ configured: boolean; providers: string[] }> {
        try {
            const tools = mcpClientService.getAllTools() || [];
            const providers = Array.from(new Set(
                tools.filter(t => ENRICHMENT_FRAGMENTS.some(f => String(t.name).toLowerCase().includes(f)))
                    .map(t => t.name)
            ));
            return { configured: providers.length > 0, providers };
        } catch {
            return { configured: false, providers: [] };
        }
    }

    // ==========================================
    // MULTI-PROPERTY MANAGEMENT
    // ==========================================

    async getProperties(organizationId: number) {
        return await db.select().from(prospectProperties).where(eq(prospectProperties.organizationId, organizationId));
    }

    async getPropertyById(organizationId: number, propertyId: number) {
        const [property] = await db.select().from(prospectProperties).where(
            and(
                eq(prospectProperties.organizationId, organizationId),
                eq(prospectProperties.id, propertyId)
            )
        );
        return property;
    }

    async createProperty(organizationId: number, data: { name: string, domain?: string, uiConfig?: any, personaAgentId?: string, personaPromptOverride?: string, deanonConfig?: any }) {
        // Enforce max 5 properties
        const existing = await this.getProperties(organizationId);
        if (existing.length >= 5) {
            throw new Error("Maximum of 5 properties allowed per organization.");
        }

        const uid = `prp_${uuidv4()}`;
        const [property] = await db.insert(prospectProperties).values({
            organizationId,
            uid,
            name: data.name,
            domain: data.domain,
            personaAgentId: data.personaAgentId,
            personaPromptOverride: data.personaPromptOverride,
            uiConfig: data.uiConfig || { hydration: "on_intervention" },
            deanonConfig: data.deanonConfig ?? null,
        }).returning();

        return property;
    }

    async updateProperty(organizationId: number, propertyId: number, data: Partial<{ name: string, domain: string, uiConfig: any, personaAgentId: string, personaPromptOverride: string, deanonConfig: any }>) {
        const property = await this.getPropertyById(organizationId, propertyId);
        if (!property) throw new NotFoundError("Property not found");

        const [updated] = await db.update(prospectProperties)
            .set({
                ...data,
                updatedAt: new Date()
            })
            .where(eq(prospectProperties.id, property.id))
            .returning();

        return updated;
    }

    async deleteProperty(organizationId: number, propertyId: number) {
        const property = await this.getPropertyById(organizationId, propertyId);
        if (!property) throw new NotFoundError("Property not found");

        await db.delete(prospectProperties).where(eq(prospectProperties.id, property.id));
        return { success: true };
    }

    async getLeadsByProperty(organizationId: number, propertyId: number) {
        // First verify property
        const property = await this.getPropertyById(organizationId, propertyId);
        if (!property) throw new NotFoundError("Property not found");

        const leads = await db
            .select({
                lead: prospectLeads,
                profile: prospectProfiles
            })
            .from(prospectLeads)
            .innerJoin(prospectProfiles, eq(prospectLeads.profileId, prospectProfiles.id))
            .where(
                and(
                    eq(prospectLeads.organizationId, organizationId),
                    eq(prospectProfiles.propertyId, propertyId)
                )
            );
        return leads;
    }

    async getEventsByLead(organizationId: number, leadId: number) {
        const [lead] = await db.select().from(prospectLeads).where(
            and(
                eq(prospectLeads.organizationId, organizationId),
                eq(prospectLeads.id, leadId)
            )
        );

        if (!lead) return null;

        const events = await db.select().from(prospectEvents).where(
            and(
                eq(prospectEvents.organizationId, organizationId),
                eq(prospectEvents.profileId, lead.profileId)
            )
        ).orderBy(prospectEvents.id);

        return events;
    }
}

export const prospectingService = new ProspectingService();


