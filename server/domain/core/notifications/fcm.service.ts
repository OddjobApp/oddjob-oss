/**
 * Firebase Cloud Messaging: delivers push to the Android app.
 *
 * Web push (push.service.ts, VAPID) reaches browsers only; a phone app is reached
 * through FCM by a per-install registration token. This calls the FCM HTTP v1 API
 * directly with a service-account token from googleapis, already a dependency,
 * rather than adding firebase-admin.
 *
 * Credentials, in order:
 * - FIREBASE_SERVICE_ACCOUNT_JSON (a key file's contents) or
 *   FIREBASE_SERVICE_ACCOUNT_FILE (a path to one);
 * - FIREBASE_PROJECT_ID alone: no key. The token comes from Application Default
 *   Credentials: on Google Cloud, the identity the server runs as; locally,
 *   `gcloud auth application-default login`. This is the mode for organizations
 *   whose policy forbids service-account keys (iam.disableServiceAccountKeyCreation).
 * With none, every send is a no-op and server/config/env.ts reports the degradation at boot.
 */
import { readFileSync } from "node:fs";
import { google } from "googleapis";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("FcmService");

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

export interface FcmMessage {
    title: string;
    body: string;
    /** Same-origin path; the app opens CREW rooms itself and anything else on the web. */
    url: string;
    tag?: string;
}

export type FcmResult = { ok: true } | { ok: false; gone: boolean; status?: number; error: string };

/** The Firebase project sends go to; a key's identity when there is a key file. */
interface ServiceAccount {
    project_id: string;
    client_email?: string;
    private_key?: string;
}

let account: ServiceAccount | null | undefined;
let auth: InstanceType<typeof google.auth.GoogleAuth> | null = null;

function loadAccount(): ServiceAccount | null {
    if (account !== undefined) return account;
    try {
        const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
        const file = process.env.FIREBASE_SERVICE_ACCOUNT_FILE;
        const raw = inline || (file ? readFileSync(file, "utf8") : null);
        if (!raw) {
            const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
            if (!projectId) return (account = null);
            // Keyless: whatever Application Default Credentials resolve to.
            // A missing login surfaces on the first send, not here.
            auth = new google.auth.GoogleAuth({ scopes: [SCOPE] });
            logger.info(`FCM uses Application Default Credentials for project ${projectId}`);
            return (account = { project_id: projectId });
        }
        const parsed = JSON.parse(raw);
        if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
            logger.error("Firebase service account is missing project_id, client_email or private_key; phone push disabled");
            return (account = null);
        }
        auth = new google.auth.GoogleAuth({
            credentials: { client_email: parsed.client_email, private_key: parsed.private_key },
            scopes: [SCOPE],
        });
        return (account = parsed as ServiceAccount);
    } catch (err: any) {
        logger.error(`Firebase service account unreadable, phone push disabled: ${err.message}`);
        return (account = null);
    }
}

/**
 * FCM's answer for a token that will never work again: the app was uninstalled,
 * its data cleared, or the token belongs to another Firebase project.
 */
export function isGoneFcmError(status: number | undefined, body: any): boolean {
    const code = body?.error?.details?.find?.((d: any) => d?.errorCode)?.errorCode ?? body?.error?.status;
    if (status === 404 || code === "UNREGISTERED") return true;
    // A malformed token is gone too; INVALID_ARGUMENT for any other reason is ours.
    return status === 400 && code === "INVALID_ARGUMENT" && /registration token/i.test(body?.error?.message ?? "");
}

/** The FCM v1 message. Exported for tests; `data` values must be strings. */
export function buildFcmMessage(token: string, message: FcmMessage) {
    return {
        message: {
            token,
            notification: { title: message.title, body: message.body },
            data: { url: message.url, ...(message.tag ? { tag: message.tag } : {}) },
            android: {
                priority: "HIGH",
                notification: {
                    channel_id: "approvals",
                    ...(message.tag ? { tag: message.tag } : {}),
                },
            },
        },
    };
}

export const fcmService = {
    isConfigured(): boolean {
        return loadAccount() !== null;
    },

    async send(token: string, message: FcmMessage): Promise<FcmResult> {
        const sa = loadAccount();
        if (!sa || !auth) return { ok: false, gone: false, error: "FCM not configured" };
        try {
            const client = await auth.getClient();
            const { token: accessToken } = await client.getAccessToken();
            const response = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
                method: "POST",
                headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
                body: JSON.stringify(buildFcmMessage(token, message)),
                signal: AbortSignal.timeout(10_000),
            });
            if (response.ok) return { ok: true };
            const body = await response.json().catch(() => ({}));
            return {
                ok: false,
                gone: isGoneFcmError(response.status, body),
                status: response.status,
                error: body?.error?.message ?? `FCM ${response.status}`,
            };
        } catch (err: any) {
            return { ok: false, gone: false, error: err?.message ?? String(err) };
        }
    },

    /** Test-only: forget the cached account so env changes take effect. */
    resetForTests(): void {
        account = undefined;
        auth = null;
    },
};
