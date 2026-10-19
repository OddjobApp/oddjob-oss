import { db } from "@server/database_service.js";
import { eq, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { apps, orgSettings } from "@shared/schema/index.js";

const logger = createLogger("CustomizationHelperService");

/**
 * App customizations
 */
export interface AppCustomizations {
    ui?: {
        theme?: string;
        layout?: string;
        density?: string;
        sidebarCollapsed?: boolean;
    };
    workflow?: {
        defaultApprovalTimeoutHours?: number;
        autoAssignReviewers?: boolean;
        requireTestCoverage?: boolean;
    };
    integrations?: {
        slackEnabled?: boolean;
        jiraEnabled?: boolean;
        githubEnabled?: boolean;
    };
}

/**
 * Organization customizations
 */
export interface OrgCustomizations {
    ui?: {
        theme?: string;
        branding?: {
            logo?: string;
            colors?: Record<string, string>;
        };
    };
    workflow?: {
        defaultApprovalTimeoutHours?: number;
        requireTestCoverage?: boolean;
    };
    security?: {
        auditLoggingEnabled?: boolean;
        encryptionEnabled?: boolean;
        mfaRequiredForCritical?: boolean;
        sessionTimeoutMinutes?: number;
    };
    notifications?: {
        slackEnabled?: boolean;
        emailEnabled?: boolean;
        digestEnabled?: boolean;
    };
}

/**
 * Customization Helper Service
 * Provides helper functions to retrieve customizations for workbenches
 */
export class CustomizationHelperService {
    private static instance: CustomizationHelperService;

    private constructor() {}

    static getInstance(): CustomizationHelperService {
        if (!CustomizationHelperService.instance) {
            CustomizationHelperService.instance = new CustomizationHelperService();
        }
        return CustomizationHelperService.instance;
    }

    /**
     * Get customizations for a specific app
     */
    async getAppCustomizations(organizationId: number, appId: number): Promise<AppCustomizations> {
        try {
            const [app] = await db.select()
                .from(apps)
                .where(and(
                    eq(apps.id, appId),
                    eq(apps.organizationId, organizationId)
                ))
                .limit(1);

            if (!app) {
                logger.warn(`[CustomizationHelper] App ${appId} not found for org ${organizationId}`);
                return {};
            }

            const config = app.config as any;
            return config?.customizations || {};
        } catch (error: any) {
            logger.error(`[CustomizationHelper] Error getting app customizations: ${error.message}`);
            return {};
        }
    }

    /**
     * Get customizations for an app by slug
     */
    async getAppCustomizationsBySlug(organizationId: number, appSlug: string): Promise<AppCustomizations> {
        try {
            const [app] = await db.select()
                .from(apps)
                .where(and(
                    eq(apps.slug, appSlug),
                    eq(apps.organizationId, organizationId)
                ))
                .limit(1);

            if (!app) {
                logger.warn(`[CustomizationHelper] App ${appSlug} not found for org ${organizationId}`);
                return {};
            }

            const config = app.config as any;
            return config?.customizations || {};
        } catch (error: any) {
            logger.error(`[CustomizationHelper] Error getting app customizations by slug: ${error.message}`);
            return {};
        }
    }

    /**
     * Get organization-level customizations
     */
    async getOrgCustomizations(organizationId: number): Promise<OrgCustomizations> {
        try {
            const [rawSettings] = await db.select()
                .from(orgSettings)
                .where(eq(orgSettings.organizationId, organizationId))
                .limit(1);
            const settings = rawSettings as any;

            if (!settings) {
                logger.warn(`[CustomizationHelper] Settings not found for org ${organizationId}`);
                return {};
            }

            // Extract customizations from settings
            const customizations: OrgCustomizations = {};

            if (settings.theme) {
                customizations.ui = { ...customizations.ui, theme: settings.theme };
            }

            if (settings.notificationConfig) {
                customizations.notifications = {
                    slackEnabled: settings.notificationConfig.slack?.enabled,
                    emailEnabled: settings.notificationConfig.email?.enabled,
                    digestEnabled: settings.notificationConfig.digestEnabled,
                };
            }

            if (settings.sessionTimeoutMinutes) {
                customizations.security = {
                    ...customizations.security,
                    sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
                };
            }

            return customizations;
        } catch (error: any) {
            logger.error(`[CustomizationHelper] Error getting org customizations: ${error.message}`);
            return {};
        }
    }

    /**
     * Get merged customizations (org + app)
     */
    async getMergedCustomizations(organizationId: number, appId: number): Promise<AppCustomizations & OrgCustomizations> {
        const [appCustomizations, orgCustomizations] = await Promise.all([
            this.getAppCustomizations(organizationId, appId),
            this.getOrgCustomizations(organizationId),
        ]);

        // Merge with org customizations taking precedence
        return {
            ...orgCustomizations,
            ...appCustomizations,
        };
    }

    /**
     * Get UI theme for an app
     */
    async getAppTheme(organizationId: number, appId: number): Promise<string> {
        const customizations = await this.getMergedCustomizations(organizationId, appId);
        return customizations.ui?.theme || "light";
    }

    /**
     * Get workflow settings for an app
     */
    async getWorkflowSettings(organizationId: number, appId: number): Promise<{
        defaultApprovalTimeoutHours?: number;
        autoAssignReviewers?: boolean;
        requireTestCoverage?: boolean;
    }> {
        const customizations = await this.getAppCustomizations(organizationId, appId);
        return customizations.workflow || {};
    }

    /**
     * Get integration settings for an app
     */
    async getIntegrationSettings(organizationId: number, appId: number): Promise<{
        slackEnabled?: boolean;
        jiraEnabled?: boolean;
        githubEnabled?: boolean;
    }> {
        const customizations = await this.getAppCustomizations(organizationId, appId);
        return customizations.integrations || {};
    }

    /**
     * Update app customizations
     */
    async updateAppCustomizations(organizationId: number, appId: number, customizations: AppCustomizations): Promise<void> {
        try {
            const [app] = await db.select()
                .from(apps)
                .where(and(
                    eq(apps.id, appId),
                    eq(apps.organizationId, organizationId)
                ))
                .limit(1);

            if (!app) {
                throw new Error(`App ${appId} not found for org ${organizationId}`);
            }

            const config = (app.config as any) || {};
            config.customizations = { ...config.customizations, ...customizations };

            await db.update(apps)
                .set({ config, updatedAt: new Date() })
                .where(eq(apps.id, appId));

            logger.info(`[CustomizationHelper] Updated customizations for app ${appId}`);
        } catch (error: any) {
            logger.error(`[CustomizationHelper] Error updating app customizations: ${error.message}`);
            throw error;
        }
    }

    /**
     * Update organization customizations
     */
    async updateOrgCustomizations(organizationId: number, customizations: OrgCustomizations): Promise<void> {
        try {
            const [rawSettings] = await db.select()
                .from(orgSettings)
                .where(eq(orgSettings.organizationId, organizationId))
                .limit(1);
            const settings = rawSettings as any;

            const updateData: Record<string, any> = { updatedAt: new Date() };

            if (customizations.ui?.theme) {
                updateData.theme = customizations.ui.theme;
            }

            if (customizations.security?.sessionTimeoutMinutes) {
                updateData.sessionTimeoutMinutes = customizations.security.sessionTimeoutMinutes;
            }

            if (settings) {
                await db.update(orgSettings)
                    .set(updateData as any)
                    .where(eq(orgSettings.id, settings.id));
            } else {
                await db.insert(orgSettings).values({
                    organizationId,
                    ...(updateData as any),
                });
            }

            logger.info(`[CustomizationHelper] Updated org customizations for org ${organizationId}`);
        } catch (error: any) {
            logger.error(`[CustomizationHelper] Error updating org customizations: ${error.message}`);
            throw error;
        }
    }
}

export const customizationHelperService = CustomizationHelperService.getInstance();
