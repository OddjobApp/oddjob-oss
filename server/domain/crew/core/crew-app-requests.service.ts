/**
 * An app's request for a person, posted into CREW as a form someone can answer.
 *
 * Apps ask for a human through the app platform API (`POST /api/oddjob/hil`),
 * which creates a pending HIL request. Before this, the request waited in the
 * app until someone happened to open it. Now it also lands in a standing room
 * for that app — one per app per org, "‹App› · Requests" — as an
 * `input_request` card. Answering the card completes the same request the app
 * polls (`/hil/:formId/poll`), and resumes a pipeline if one waits on it.
 *
 * A dedicated room rather than whichever room was last active: a form dropped
 * into an unrelated conversation is noise there and easy to lose. The room sits
 * in the app's Project Space, so a private project's requests stay private.
 *
 * A room nobody is in is a room nobody finds: the room list shows the rooms a
 * person takes part in. So the people who answer for the app — its project's
 * owner and user members, or the org admins for an app outside any project —
 * are made participants, and each is sent a push that opens the room. The room
 * mechanics are shared with other standing rooms (crew-standing-rooms.ts).
 */

import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { apps, appDeployments } from "@shared/schema/index.js";
import type { HilFormRow } from "@domain/pipeline/core/hil-requests.service.js";
import { createLogger } from "@server/utils/logger.js";
import {
    ensureStandingRoom,
    insertRoomNotice,
    publishRoomNotice,
    roomResponders,
    seatAndNotify,
    standingRoomPath,
} from "./crew-standing-rooms.js";

const logger = createLogger("CrewAppRequests");

/** Stable per (org, app), so concurrent requests converge on one room. */
export function appRequestsSessionKey(appId: number): string {
    return `app-requests-${appId}`;
}

/** Path that opens an app's requests room for its org. */
export function appRequestsRoomPath(orgId: number, appId: number): string {
    return standingRoomPath(orgId, appRequestsSessionKey(appId));
}

export interface PostedAppRequest {
    sessionKey: string;
    /** Opens the room; used by the Slack/Teams announcement instead of the inbox. */
    path: string;
    recipients: number;
    notified: number;
}

interface AppForRequest {
    appId: number;
    name: string;
    projectId: number | null;
}

/**
 * The app behind an app-raised request. `schema.sourceId` carries the
 * deployment id; it must be a deployment of the request's own org.
 */
async function appForRequest(form: HilFormRow): Promise<AppForRequest | null> {
    const orgId = form.organizationId;
    const schema = (form.schema ?? {}) as { sourceType?: unknown; sourceId?: unknown };
    const deploymentId = Number(schema.sourceId);
    if (orgId == null || schema.sourceType !== "app" || !Number.isInteger(deploymentId)) return null;

    const [row] = await db
        .select({ appId: apps.id, name: apps.name, appProjectId: apps.projectId, deploymentProjectId: appDeployments.projectId })
        .from(appDeployments)
        .innerJoin(apps, eq(appDeployments.appId, apps.id))
        .where(and(eq(appDeployments.id, deploymentId), eq(appDeployments.organizationId, orgId)))
        .limit(1);
    if (!row) return null;
    return { appId: row.appId, name: row.name, projectId: row.deploymentProjectId ?? row.appProjectId ?? null };
}

/**
 * Post an app-raised HIL request into its app's requests room and tell the
 * people who answer for the app. Null when the request is not an app's (or its
 * app cannot be resolved in the request's org).
 */
export async function postAppRequestToCrew(form: HilFormRow): Promise<PostedAppRequest | null> {
    if (form.kind !== "request" || form.requestSource !== "app" || form.organizationId == null) return null;
    const orgId = form.organizationId;

    const app = await appForRequest(form);
    if (!app) {
        logger.warn(`HIL request ${form.id} names no deployment of org ${orgId}; not posted to CREW.`);
        return null;
    }
    const session = await ensureStandingRoom({
        orgId,
        sessionKey: appRequestsSessionKey(app.appId),
        title: `${app.name} · Requests`,
        activeTopic: `Requests from ${app.name} that need a person`,
        projectId: app.projectId,
    });
    if (!session) return null;

    const schema = (form.schema ?? {}) as Record<string, unknown>;
    const turn = await insertRoomNotice(session, {
        speakerName: app.name,
        content: `**${app.name}** needs a person to answer this before it can continue.`,
        artifacts: [{
            tool: "app_request",
            payload: {
                type: "input_request",
                title: form.name,
                description: form.description ?? "",
                requestId: form.id,
                formId: form.id,
                schema: { fields: Array.isArray(schema.fields) ? schema.fields : [] },
                submitLabel: typeof schema.submitLabel === "string" ? schema.submitLabel : undefined,
            },
        }],
    });
    if (turn) publishRoomNotice(session, turn);

    const path = appRequestsRoomPath(orgId, app.appId);
    const recipients = await roomResponders(orgId, { id: session.id, projectId: session.projectId ?? null });
    if (recipients.length === 0) {
        logger.warn(`HIL request ${form.id} from ${app.name}: no project members or org admins to notify in org ${orgId}.`);
    }
    const notified = await seatAndNotify(session, recipients, {
        title: `${app.name} needs an answer`,
        body: form.description || form.name,
        tag: `app-request-${form.id}`,
    });
    return { sessionKey: session.sessionKey, path, recipients: recipients.length, notified };
}
