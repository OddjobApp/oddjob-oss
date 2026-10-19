/**
 * Shared contract for the "Reauthorize <Platform>" surface.
 *
 * The server flags a connector/connection whose OAuth grant can no longer be
 * renewed (the provider rejected the refresh, or no refresh token was ever
 * issued) and the client renders a card pointing at the reconnect route. Only
 * reason codes cross the wire — provider error text can contain
 * credential-bearing URLs and is never stored or returned.
 */
export type ReauthorizationReason = 'refresh_rejected' | 'no_refresh_token' | 'credentials_missing';

export interface ReauthorizationItem {
    kind: 'organization' | 'user';
    platform: string;
    label: string;
    connectorId: number;
    projectId: number | null;
    reason: ReauthorizationReason | null;
    since: string | null;
    /** Initiate route (orgId/projectId already in the query) or a dashboard path. */
    reconnectUrl: string;
    /** True when reconnectUrl is an in-app dashboard path rather than an OAuth initiate route. */
    opensDashboard: boolean;
    /** False when only an org admin may reauthorize (e.g. QuickBooks). */
    canReauthorize: boolean;
}
