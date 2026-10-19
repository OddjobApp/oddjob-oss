import { SDLC_HANDOFF_COLLECTION, SDLC_DEPLOYMENT_LAUNCH_COLLECTION, SDLC_SOURCE_COLLECTIONS } from './sdlc-stage-handoff.js';
import { INCIDENT_COLLECTION } from './incident-workflow.js';
import { WAYFARE_COLLECTION, WAYFARE_JOURNEY_COLLECTION } from './wayfare-workflow.js';

/**
 * `app_records` collections that only their governed APIs may write: handoff,
 * deployment-launch, incident and trip receipts. Generic dataset writes, record
 * actions and agent-chat transcripts must refuse them, or an app could forge a
 * receipt the workflow later trusts.
 */
export const WORKFLOW_RECEIPT_COLLECTIONS: readonly string[] = [
    SDLC_HANDOFF_COLLECTION,
    SDLC_DEPLOYMENT_LAUNCH_COLLECTION,
    INCIDENT_COLLECTION,
    WAYFARE_COLLECTION,
    WAYFARE_JOURNEY_COLLECTION,
];

export function isWorkflowReceiptCollection(collection: unknown): boolean {
    return typeof collection === 'string' && WORKFLOW_RECEIPT_COLLECTIONS.includes(collection);
}

/** SDLC evidence collections: writable only with a server-bound source context. */
export function isSdlcSourceCollection(collection: unknown): boolean {
    return typeof collection === 'string' && (SDLC_SOURCE_COLLECTIONS as readonly string[]).includes(collection);
}
