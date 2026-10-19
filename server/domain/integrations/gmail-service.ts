/**
 * Gmail OAuth2 Service
 * 
 * Provides email sending capabilities using Gmail API with OAuth2 authentication.
 * Used for HIL (Human-in-the-Loop) approval notifications.
 */

import { google } from 'googleapis';
import { db } from '../../database_service.js';
import { credentials } from '@shared/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';
import { credentialSecretStore } from '@domain/auth/core/credential-secret-store.js';

const logger = createLogger('GmailService');

// Gmail OAuth2 scopes required for sending email
const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

interface GmailTokens {
    accessToken: string;
    refreshToken: string;
}

/**
 * What the credential row's metadata holds. The OAuth tokens used to live here
 * in plain text, and GET /api/credentials returned metadata to every member -
 * a refresh token is the mailbox. An organization's tokens are now in
 * credentialSecretStore; only a platform-level (no-org) Gmail keeps them here,
 * since the store seals every secret to an organization.
 */
interface GmailCredentialMetadata extends Partial<GmailTokens> {
    tokenExpiry: string;
    email: string;
}

type GmailCredentialRow = typeof credentials.$inferSelect;

function orgCondition(organizationId: number | null) {
    // `= NULL` never matches; a platform-level Gmail is `IS NULL`.
    return organizationId ? eq(credentials.organizationId, organizationId) : isNull(credentials.organizationId);
}

async function readTokens(cred: GmailCredentialRow): Promise<GmailTokens | null> {
    const metadata = (cred.metadata ?? {}) as GmailCredentialMetadata;
    if (cred.organizationId) {
        const stored = await credentialSecretStore.resolve({ ...cred, envVarName: null });
        if (stored) return JSON.parse(stored) as GmailTokens;
        if (metadata.accessToken || metadata.refreshToken) {
            // Written before tokens were stored encrypted: move them, then strip.
            const tokens = { accessToken: metadata.accessToken ?? '', refreshToken: metadata.refreshToken ?? '' };
            await writeTokens(cred, tokens, metadata);
            return tokens;
        }
        return null;
    }
    return metadata.accessToken || metadata.refreshToken
        ? { accessToken: metadata.accessToken ?? '', refreshToken: metadata.refreshToken ?? '' }
        : null;
}

async function writeTokens(cred: GmailCredentialRow, tokens: GmailTokens, metadata: GmailCredentialMetadata): Promise<void> {
    const { accessToken: _a, refreshToken: _r, ...rest } = metadata;
    if (cred.organizationId) {
        await credentialSecretStore.save(cred, JSON.stringify(tokens));
        await db.update(credentials).set({ metadata: rest }).where(eq(credentials.id, cred.id));
    } else {
        await db.update(credentials).set({ metadata: { ...rest, ...tokens } }).where(eq(credentials.id, cred.id));
    }
}

interface HilEmailContext {
    pipelineName: string;
    stepName: string;
    formName?: string;
    contextData?: Record<string, any>;
}

export class GmailService {
    /**
     * Holds only the app's OAuth client id/secret — used to build the consent
     * URL, never given an organization's tokens. This service is a singleton:
     * it used to load an org's tokens onto this one client, so a send for org A
     * that awaited between loadCredentials and sendHilNotification could go out
     * from org B's mailbox. Every authorized call now gets its own client.
     */
    private oauth2Client: any;

    constructor() {
        this.oauth2Client = this.newClient();
    }

    private newClient(): any {
        const clientId = process.env.GMAIL_CLIENT_ID;
        const clientSecret = process.env.GMAIL_CLIENT_SECRET;
        const redirectUri = process.env.GMAIL_REDIRECT_URI || 'http://localhost:5000/api/gmail/oauth/callback';
        return clientId && clientSecret ? new google.auth.OAuth2(clientId, clientSecret, redirectUri) : null;
    }

    /** A client authorized as this organization's connected mailbox, or null. */
    private async clientFor(organizationId: number | null): Promise<any | null> {
        const client = this.newClient();
        if (!client) return null;

        const [cred] = await db.select().from(credentials)
            .where(and(eq(credentials.type, 'gmail_oauth'), orgCondition(organizationId)))
            .limit(1);
        if (!cred) return null;
        const stored = await readTokens(cred);
        if (!stored) return null;

        const metadata = (cred.metadata ?? {}) as GmailCredentialMetadata;
        client.setCredentials({
            access_token: stored.accessToken,
            refresh_token: stored.refreshToken,
            expiry_date: metadata.tokenExpiry ? new Date(metadata.tokenExpiry).getTime() : undefined,
        });
        // One listener on one short-lived client: refreshed tokens go back to
        // this organization's credential only.
        client.on('tokens', async (tokens: any) => {
            if (tokens.access_token) {
                await writeTokens(cred, { ...stored, accessToken: tokens.access_token }, {
                    ...metadata,
                    tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : metadata.tokenExpiry,
                });
                logger.debug('Gmail OAuth tokens refreshed');
            }
        });
        return client;
    }

    /**
     * Check if Gmail is configured
     */
    isConfigured(): boolean {
        return !!this.oauth2Client;
    }

    /**
     * Generate OAuth2 authorization URL
     */
    getAuthUrl(): string {
        if (!this.oauth2Client) {
            throw new Error('Gmail OAuth not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.');
        }

        return this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            prompt: 'consent', // Force refresh token generation
        });
    }

    /**
     * Exchange authorization code for tokens
     */
    async handleOAuthCallback(code: string, organizationId: number | null, userId: string): Promise<void> {
        const client = this.newClient();
        if (!client) {
            throw new Error('Gmail OAuth not configured');
        }

        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);

        // Get user email
        const gmail = google.gmail({ version: 'v1', auth: client });
        const profile = await gmail.users.getProfile({ userId: 'me' });
        const email = profile.data.emailAddress || 'unknown';

        const metadata: GmailCredentialMetadata = {
            tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : '',
            email,
        };
        const secret: GmailTokens = { accessToken: tokens.access_token!, refreshToken: tokens.refresh_token! };

        // Check if existing Gmail credential exists
        const [existing] = await db.select().from(credentials)
            .where(and(eq(credentials.type, 'gmail_oauth'), orgCondition(organizationId)))
            .limit(1);

        const cred = existing ?? (await db.insert(credentials).values({
            name: `Gmail (${email})`,
            type: 'gmail_oauth',
            description: 'Gmail OAuth2 credentials for HIL email notifications',
            organizationId,
            createdBy: userId,
            envVarName: '', // Tokens live in the credential secret store, not the environment.
            metadata,
        }).returning())[0];
        await writeTokens(cred, secret, metadata);

        logger.info('Gmail OAuth tokens stored', { email, organizationId });
    }

    /** Whether this organization has a connected Gmail mailbox. Changes no state. */
    async loadCredentials(organizationId: number | null): Promise<boolean> {
        return (await this.clientFor(organizationId)) !== null;
    }

    /**
     * Send HIL notification email from this organization's connected mailbox.
     */
    async sendHilNotification(
        organizationId: number | null,
        to: string,
        hilLink: string,
        context: HilEmailContext,
        subject?: string
    ): Promise<{ success: boolean; messageId?: string; error?: string }> {
        try {
            const client = await this.clientFor(organizationId);
            if (!client) {
                throw new Error('Gmail not configured');
            }

            const gmail = google.gmail({ version: 'v1', auth: client });

            // Build HTML email
            const html = this.buildHilEmailHtml(hilLink, context);
            const emailSubject = subject || `Action Required: ${context.pipelineName} - ${context.stepName}`;

            // Create email in RFC 2822 format
            const email = [
                `To: ${to}`,
                `Subject: ${emailSubject}`,
                'Content-Type: text/html; charset=utf-8',
                '',
                html,
            ].join('\r\n');

            // Encode as base64url
            const encodedEmail = Buffer.from(email)
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

            const response = await gmail.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: encodedEmail,
                },
            });

            logger.info('HIL email sent', { to, messageId: response.data.id, pipeline: context.pipelineName });

            return { success: true, messageId: response.data.id || undefined };
        } catch (error: any) {
            logger.error('Failed to send HIL email', { to, error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Build HTML email for HIL notification
     */
    private buildHilEmailHtml(hilLink: string, context: HilEmailContext): string {
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Action Required</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f5f5f5;">
        <tr>
            <td style="padding: 40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    <!-- Header -->
                    <tr>
                        <td style="padding: 32px 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px 12px 0 0;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">
                                ⚡ Action Required
                            </h1>
                        </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px;">
                            <p style="margin: 0 0 16px; font-size: 16px; color: #333333;">
                                A pipeline step requires your input to continue:
                            </p>
                            
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f8f9fa; border-radius: 8px; margin: 24px 0;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <p style="margin: 0 0 8px; font-size: 14px; color: #666666;">Pipeline</p>
                                        <p style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: #333333;">${context.pipelineName}</p>
                                        
                                        <p style="margin: 0 0 8px; font-size: 14px; color: #666666;">Step</p>
                                        <p style="margin: 0; font-size: 18px; font-weight: 600; color: #333333;">${context.stepName}</p>
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- CTA Button -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 32px auto;">
                                <tr>
                                    <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px;">
                                        <a href="${hilLink}" target="_blank" style="display: inline-block; padding: 16px 40px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">
                                            Complete Task →
                                        </a>
                                    </td>
                                </tr>
                            </table>
                            
                            <p style="margin: 24px 0 0; font-size: 14px; color: #888888; text-align: center;">
                                This link is secure and unique to you. Do not share it with others.
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 24px 40px; border-top: 1px solid #e5e5e5;">
                            <p style="margin: 0; font-size: 12px; color: #888888; text-align: center;">
                                Sent by Oddjob Agentic Agency
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
    }
}

// Singleton instance
export const gmailService = new GmailService();


