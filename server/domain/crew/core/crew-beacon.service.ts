/**
 * Location beacons: a person shares one position from a CREW room.
 *
 * The position is posted to the room as a map card, so the people in it see
 * it and the agents have it as context on their next round; posting it does
 * not start a round. Everyone in the room's project (its user members and its
 * owner), and anyone taking part in the room, is sent a push (browser or phone)
 * that opens the room. A room outside a project notifies its participants. One
 * fix, sent only when the person raises it: nothing is tracked.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { projectMembers, projects } from "@shared/schema/index.js";
import { pushService } from "@domain/core/notifications/push.service.js";
import { ValidationError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { crewParticipantsService } from "./crew-participants.service.js";
import { crewRepository } from "./crew-repository.js";
import { crewStreamService } from "./crew-stream.service.js";

const logger = createLogger("CrewBeacon");

export interface BeaconInput {
    lat: number;
    lng: number;
    /** Radius of the fix, in metres, as the phone reports it. */
    accuracyM?: number;
    /** When the phone took the fix (ISO 8601); the server's clock otherwise. */
    at?: string;
}

/** Validates what the phone sent; throws a ValidationError naming the bad field. */
export function parseBeacon(body: any): BeaconInput {
    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new ValidationError("lat must be between -90 and 90", { field: "lat" });
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new ValidationError("lng must be between -180 and 180", { field: "lng" });
    let accuracyM: number | undefined;
    if (body?.accuracyM !== undefined && body?.accuracyM !== null) {
        accuracyM = Number(body.accuracyM);
        if (!Number.isFinite(accuracyM) || accuracyM < 0 || accuracyM > 100_000) {
            throw new ValidationError("accuracyM must be between 0 and 100000", { field: "accuracyM" });
        }
    }
    let at: string | undefined;
    if (typeof body?.at === "string") {
        const t = Date.parse(body.at);
        // A fix from the future or from yesterday is the phone's clock talking, not a time to show.
        if (Number.isFinite(t) && Math.abs(Date.now() - t) < 24 * 3600_000) at = new Date(t).toISOString();
    }
    return { lat, lng, accuracyM, at };
}

/** The room's map card for a beacon (rendered by MapSurface on the web, MapCard on Android). */
export function beaconMapPayload(name: string, b: BeaconInput, at: string) {
    const accuracy = b.accuracyM !== undefined ? `±${Math.round(b.accuracyM)} m` : "accuracy unknown";
    return {
        type: "assistant_map",
        title: `${name}'s location`,
        description: `Location beacon · ${accuracy} · ${at}`,
        markers: [{ lat: b.lat, lng: b.lng, label: name, description: `Shared ${at} · ${accuracy}` }],
        center: { lat: b.lat, lng: b.lng },
        zoom: 15,
        mapStyle: "streets",
        beacon: { accuracyM: b.accuracyM ?? null, at },
    };
}

/** What the agents read: the coordinates in words, since prose is their context. */
export function beaconTurnText(name: string, b: BeaconInput, at: string): string {
    const accuracy = b.accuracyM !== undefined ? ` (accuracy ±${Math.round(b.accuracyM)} m)` : "";
    return `📍 ${name} raised a location beacon: ${b.lat.toFixed(5)}, ${b.lng.toFixed(5)}${accuracy} at ${at}.`;
}

/**
 * Who a beacon reaches: the project's people when the room is in one, and the
 * room's participants either way. Agents are project principals too; only
 * user principals are notified (agents see the beacon in the room).
 */
export async function beaconRecipients(orgId: number, room: { id: number; projectId?: number | null }, senderId: string): Promise<string[]> {
    const people = new Set<string>();
    if (room.projectId != null) {
        const [project] = await db
            .select({ ownerUserId: projects.ownerUserId })
            .from(projects)
            .where(and(eq(projects.id, room.projectId), eq(projects.organizationId, orgId)))
            .limit(1);
        // A project id that is not this org's is not a project to notify.
        if (project) {
            if (project.ownerUserId) people.add(project.ownerUserId);
            const members = await db
                .select({ principalId: projectMembers.principalId })
                .from(projectMembers)
                .where(and(eq(projectMembers.projectId, room.projectId), eq(projectMembers.principalType, "user")));
            members.forEach((m) => people.add(m.principalId));
        }
    }
    (await crewParticipantsService.list(room.id)).forEach((p) => people.add(p.userId));
    people.delete(senderId);
    return [...people];
}

export const crewBeaconService = {
    /**
     * Posts the beacon to the room, then notifies everyone else in it.
     * @returns the posted turn and how many people were notified.
     */
    async raise(params: {
        orgId: number;
        room: { id: number; sessionKey: string; projectId?: number | null };
        userId: string;
        displayName: string;
        beacon: BeaconInput;
    }) {
        const { orgId, room, userId, displayName, beacon } = params;
        const at = beacon.at ?? new Date().toISOString();
        await crewParticipantsService.ensureParticipant(room.id, orgId, userId);
        const turn = await crewRepository.postTurn(orgId, room.id, {
            speakerType: "user",
            speakerName: displayName,
            userId,
            content: beaconTurnText(displayName, beacon, at),
            artifacts: [{ tool: "location_beacon", payload: beaconMapPayload(displayName, beacon, at) }],
        });
        await crewStreamService.publish({ type: "turn", organizationId: orgId, sessionKey: room.sessionKey, actor: userId, payload: { speakerType: "user" } });

        const recipients = await beaconRecipients(orgId, room, userId);
        let notified = 0;
        for (const recipient of recipients) {
            try {
                const delivered = await pushService.sendToUser(recipient, {
                    title: `${displayName} shared their location`,
                    body: `Tap to see ${displayName} on the map in the room.`,
                    url: `/workspace/chat/${encodeURIComponent(room.sessionKey)}?orgId=${orgId}`,
                    tag: `beacon-${room.id}-${userId}`,
                });
                if (delivered > 0) notified++;
            } catch (err: any) {
                logger.warn(`Beacon push to ${recipient} failed: ${err?.message ?? err}`);
            }
        }
        return { turn, notified, recipients: recipients.length };
    },
};
