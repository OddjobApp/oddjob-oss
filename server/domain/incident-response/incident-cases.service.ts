import { createHash, randomUUID } from 'node:crypto';
import { and, eq, desc, isNull, lt, sql } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { apps, crewSessions, appRecords } from '@shared/schema/index.js';
import { BadRequestError, NotFoundError } from '@server/utils/errors.js';
import { INCIDENT_COLLECTION, incidentCommandSchema, incidentTransitionBlocker, type IncidentCase } from '@shared/incident-workflow.js';
interface Actor {
    appId: number;
    orgId: number;
    deploymentId: number;
}
async function roomScope(database: Pick<typeof db, 'select'>, actor: Actor, roomKey: unknown) {
    if (typeof roomKey !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(roomKey))
        throw new BadRequestError('Open incident response inside a CREW room.');
    const [app] = await database
        .select({ projectId: apps.projectId })
        .from(apps)
        .where(and(eq(apps.id, actor.appId), eq(apps.organizationId, actor.orgId)))
        .limit(1);
    if (!app) throw new NotFoundError('App unavailable.');
    const [room] = await database
        .select({ id: crewSessions.id })
        .from(crewSessions)
        .where(
            and(
                eq(crewSessions.organizationId, actor.orgId),
                eq(crewSessions.sessionKey, roomKey),
                app.projectId == null ? isNull(crewSessions.projectId) : eq(crewSessions.projectId, app.projectId),
            ),
        )
        .limit(1);
    if (!room) throw new NotFoundError('Room unavailable in the app’s Project Space.');
    return roomKey;
}
const scope = (actor: Actor, roomKey: string) =>
    and(
        eq(appRecords.appId, actor.appId),
        eq(appRecords.orgId, actor.orgId),
        eq(appRecords.collection, INCIDENT_COLLECTION),
        sql`${appRecords.data}->>'roomKey' = ${roomKey}`,
    );
export async function listIncidentCases(actor: Actor, roomKey: unknown, cursor?: unknown) {
    const room = await roomScope(db, actor, roomKey);
    const before = cursor === undefined ? null : Number(cursor);
    if (before !== null && (!Number.isSafeInteger(before) || before < 1)) throw new BadRequestError('Invalid incident history cursor.');
    const rows = await db
        .select()
        .from(appRecords)
        .where(and(scope(actor, room), ...(before ? [lt(appRecords.id, before)] : [])))
        .orderBy(desc(appRecords.id))
        .limit(51);
    return {
        items: rows.slice(0, 50).map((row) => {
            const incident = row.data as unknown as IncidentCase;
            return { ...incident, events: incident.events.slice(-5) };
        }),
        nextCursor: rows.length > 50 ? rows[49].id : null,
    };
}
export async function readIncidentCase(actor: Actor, roomKey: unknown, id: string) {
    const room = await roomScope(db, actor, roomKey);
    const [row] = await db
        .select()
        .from(appRecords)
        .where(and(scope(actor, room), eq(appRecords.recordId, id)))
        .limit(1);
    if (!row) throw new NotFoundError('Incident unavailable.');
    return row.data as unknown as IncidentCase;
}
export async function commandIncidentCase(actor: Actor, roomKey: unknown, body: unknown) {
    const parsed = incidentCommandSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((issue) => issue.message).join('; '));
    const command = parsed.data;
    const fingerprint = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    return db.transaction(async (database) => {
        const room = await roomScope(database, actor, roomKey);
        // Serialize command IDs per owning app, without sharing a lock or data across tenants.
        await database.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${actor.orgId}:${actor.appId}:incidents`}))`);
        const [replayed] = await database
            .select()
            .from(appRecords)
            .where(
                and(scope(actor, room), sql`${appRecords.data}->'events' @> ${JSON.stringify([{ requestId: command.requestId }])}::jsonb`),
            )
            .limit(1);
        if (replayed) {
            const incident = replayed.data as unknown as IncidentCase;
            if (incident.events.find((event) => event.requestId === command.requestId)?.fingerprint !== fingerprint)
                throw new BadRequestError('Command ID already used with different inputs.');
            return { incident, replayed: true };
        }
        const at = new Date().toISOString();
        if (command.action === 'declare') {
            const incident: IncidentCase = {
                id: randomUUID(),
                roomKey: room,
                title: command.title,
                description: command.description,
                severity: command.severity,
                status: 'open',
                version: 1,
                createdAt: at,
                updatedAt: at,
                events: [
                    {
                        requestId: command.requestId,
                        fingerprint,
                        action: 'declared',
                        at,
                        deploymentId: actor.deploymentId,
                        note: command.description,
                    },
                ],
            };
            await database
                .insert(appRecords)
                .values({ appId: actor.appId, orgId: actor.orgId, collection: INCIDENT_COLLECTION, recordId: incident.id, data: incident });
            return { incident, replayed: false };
        }
        const [row] = await database
            .select()
            .from(appRecords)
            .where(and(scope(actor, room), eq(appRecords.recordId, command.incidentId)))
            .limit(1)
            .for('update');
        if (!row) throw new NotFoundError('Incident unavailable.');
        const current = row.data as unknown as IncidentCase;
        const blocker = incidentTransitionBlocker(current, command);
        if (blocker) throw new BadRequestError(blocker);
        if (current.events.length >= 1000)
            throw new BadRequestError('Incident timeline limit reached. Archive through a reviewed retention process.');
        const incident: IncidentCase = {
            ...current,
            status: command.status,
            version: current.version + 1,
            updatedAt: at,
            ...(command.commander ? { commander: command.commander } : {}),
            events: [
                ...current.events,
                {
                    requestId: command.requestId,
                    fingerprint,
                    action: command.status,
                    at,
                    deploymentId: actor.deploymentId,
                    note: command.note,
                    ...(command.evidenceUrl ? { evidenceUrl: command.evidenceUrl } : {}),
                },
            ],
        };
        await database.update(appRecords).set({ data: incident, updatedAt: new Date() }).where(eq(appRecords.id, row.id));
        return { incident, replayed: false };
    });
}
