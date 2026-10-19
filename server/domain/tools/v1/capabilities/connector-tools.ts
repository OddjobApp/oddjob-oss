import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ConnectorTools");

/**
 * In-room connection initiation.
 *
 * A room that needs Google Docs, Jira, or M365 cannot connect one itself —
 * the OAuth consent screen belongs to a person, and the resulting connector
 * is written scoped to THIS project space (saas_connectors.projectId), never
 * org-wide. The tool therefore returns a `connection_request` artifact: a
 * card carrying the OAuth initiate URL for a person to click.
 *
 * The URL is the route, not a pre-minted authorize link — state expires after
 * ten minutes in Redis, so minting at click time keeps the card valid for the
 * life of the transcript.
 *
 * Platforms with no OAuth adapter still render a card pointing at the
 * Connectors Dashboard, where the API-key/service-account path lives.
 */
const CONNECTABLE_PLATFORMS: Record<string, {
    providerLabel: string;
    authMethod: "oauth2" | "api_key";
    /** Relative route that mints state and redirects to the provider. */
    initiatePath?: string;
    /** Extra query args for the initiate route, e.g. a scope profile. */
    initiateQuery?: string;
    perUser?: boolean;
    scopeNote: string;
}> = {
    youtube: {
        providerLabel: 'YouTube', authMethod: 'oauth2',
        initiatePath: '/api/saas/connectors/google/oauth/initiate', initiateQuery: 'for=youtube',
        scopeNote: 'Google sign-in grants YouTube access for this project, including reading and approved comment replies.',
    },
    google_calendar: {
        providerLabel: "Google Calendar",
        authMethod: "oauth2",
        initiatePath: "/api/saas/connectors/google/oauth/initiate",
        initiateQuery: "for=calendar",
        scopeNote: "Google sign-in grants calendar management, event editing, invitations, and availability for this project space.",
    },
    gmail: {
        providerLabel: "Gmail",
        authMethod: "oauth2",
        initiatePath: "/api/saas/connectors/google/oauth/initiate",
        initiateQuery: "for=gmail",
        scopeNote: "Google sign-in grants email reading, draft management, sending, and mailbox organization for this project space.",
    },
    google_workspace: {
        providerLabel: "Gmail + Google Drive",
        authMethod: "oauth2",
        initiatePath: "/api/saas/connectors/google/oauth/initiate",
        initiateQuery: "for=workspace",
        scopeNote: "Google sign-in grants email reading/sending and Drive read/write for this project space.",
    },
    google_drive: {
        providerLabel: "Google Drive",
        authMethod: "oauth2",
        initiatePath: "/api/saas/connectors/google/oauth/initiate",
        initiateQuery: "for=drive",
        scopeNote: "OAuth2 sign-in granting Drive read/write for this project space.",
    },
    granola: {
        providerLabel: 'Granola', authMethod: 'oauth2', perUser: true,
        initiatePath: '/api/me/connections/granola/oauth/initiate',
        scopeNote: 'Personal Granola sign-in grants access to meeting notes visible to you in your active Granola workspace.',
    },
    quickbooks: {
        providerLabel: 'QuickBooks Online', authMethod: 'oauth2',
        initiatePath: '/api/saas/connectors/quickbooks/oauth/initiate',
        scopeNote: 'Connect your QuickBooks company for accounting reads and approved invoice creation. No automatic email sending or payment collection.',
    },
    microsoft365: {
        providerLabel: "Microsoft 365",
        authMethod: "oauth2",
        initiatePath: "/api/saas/connectors/microsoft/oauth/initiate",
        scopeNote: "OAuth2 sign-in granting OneDrive/SharePoint document access for this project space.",
    },
    jira: {
        providerLabel: "Jira",
        authMethod: "oauth2",
        initiatePath: "/api/saas/connectors/jira/oauth/initiate",
        scopeNote: "OAuth2 sign-in granting Jira access for this project space.",
    },
    confluence: {
        providerLabel: "Confluence",
        authMethod: "api_key",
        scopeNote: "API token — connect it from the Connectors Dashboard.",
    },
    amazon: {
        providerLabel: "Amazon Product Data",
        authMethod: "api_key",
        scopeNote:
            "Product-data credential (Amazon Creators API, Rainforest or SerpApi) — add it as an " +
            "api_key credential with metadata.provider amazon_creators / amazon_rainforest / " +
            "amazon_serpapi from the Connectors Dashboard. Purchases still complete in the buyer's " +
            "own Amazon session; no Amazon login is connected here.",
    },
    slack: {
        providerLabel: "Slack",
        authMethod: "oauth2",
        scopeNote: "OAuth2 install — connect it from the Connectors Dashboard.",
    },
    servicenow: {
        providerLabel: "ServiceNow",
        authMethod: "api_key",
        scopeNote: "Instance credentials — connect it from the Connectors Dashboard.",
    },
};

export const CONNECTOR_TOOLS: Record<string, ToolDefinition> = {
    connect_platform: {
        name: "connect_platform",
        idempotency: "read-safe",
        label: "Request a Platform Connection",
        group: "Integrations",
        riskLevel: "low",
        description:
            "Ask a person to connect an external platform — Gmail, Google Drive/Docs, Google Workspace, Microsoft 365, Jira — to this project " +
            "space. Call it when a needed integration is missing (e.g. a Google Docs read reports no connection) " +
            "rather than reporting the task impossible. Writes nothing: it returns a card a person clicks through. " +
            "The connection is created scoped to the current project space, not the whole organization.",
        parameters: z.object({
            platform: z.enum(["youtube", "gmail", "google_calendar", "google_workspace", "google_drive", "microsoft365", "quickbooks", "granola", "jira", "confluence", "slack", "servicenow", "amazon"])
                .describe("Which platform the room needs connected"),
            reason: z.string().min(1).max(500)
                .describe("Why the room needs it — shown on the card so the person knows what they're approving"),
        }),
        execute: async (params: { platform: keyof typeof CONNECTABLE_PLATFORMS; reason: string }, context: ToolContext) => {
            const orgId = context?.organizationId != null ? Number(context.organizationId) : null;
            const projectId = (context as any)?.projectId != null ? Number((context as any).projectId) : null;
            const projectKey = (context as any)?.projectKey ?? null;

            if (orgId == null) return JSON.stringify({ error: "No organization in context." });
            const spec = CONNECTABLE_PLATFORMS[params.platform];
            if (!spec) {
                return JSON.stringify({ error: `No connection flow exists for '${params.platform}'.` });
            }

            // Connections are project-space scoped: without a project there is
            // nothing to scope the connector to, and minting an org-wide one
            // from a room would widen reach for every project silently.
            if (projectId == null && !spec.perUser) {
                return JSON.stringify({
                    error: "Connections are created per project space. This room is not inside one — " +
                        "open the room in a project, or connect it org-wide from the Connectors Dashboard.",
                });
            }

            const query = new URLSearchParams({ orgId: String(orgId) });
            if (projectId != null && !spec.perUser) query.set('projectId', String(projectId));
            if (spec.initiateQuery) {
                for (const [k, v] of new URLSearchParams(spec.initiateQuery)) query.set(k, v);
            }

            const connectUrl = spec.initiatePath
                ? `${spec.initiatePath}?${query.toString()}`
                : `/admin/integrations?platform=${encodeURIComponent(params.platform)}`;

            logger.info(`[connect_platform] ${params.platform} requested for project ${projectId} (org ${orgId})`);

            return JSON.stringify({
                type: "connection_request",
                platform: params.platform,
                providerLabel: spec.providerLabel,
                authMethod: spec.authMethod,
                connectUrl,
                projectId,
                projectKey,
                reason: params.reason,
                scopeNote: spec.scopeNote,
            });
        },
    },
};
