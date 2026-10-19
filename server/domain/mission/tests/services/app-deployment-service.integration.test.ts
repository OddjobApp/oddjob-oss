import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { db } from "@server/database_service.js";
import { apps, appDeployments, orgs, jobs } from '@shared/schema/index.js';
import { AppDeploymentService } from "@domain/apps/app-deployment.service.js";
import { appRegistryService } from "@domain/apps/app-registry.service.js";
import { hashPassword } from '@server/domain/auth/index.js';
import { eq } from 'drizzle-orm';

describe('AppDeploymentService', () => {
    let orgId: number;
    let testAppId: number;
    let testDeploymentId: number;

    beforeAll(async () => {
        // Create an org with unique name
        const [org] = await db.insert(orgs).values({
            name: `Test Org App Deploy - ${Date.now()}`
        }).returning();
        orgId = org.id;

        // Register a test app
        const app = await appRegistryService.registerApp({
            name: 'Test App Deploy',
            slug: 'test-app-deploy-' + Date.now(),
            description: 'Test app for deployment',
            isPublic: true,
            isSystem: false,
            version: '1.0.0'
        });
        testAppId = app.id;

        // Install app for org
        const { deployment } = await appRegistryService.installApp(testAppId, orgId);
        testDeploymentId = deployment.id;
    });

    afterAll(async () => {
        // Cleanup
        await db.delete(appDeployments).where(eq(appDeployments.appId, testAppId));
        await db.delete(apps).where(eq(apps.id, testAppId));
        await db.delete(jobs).where(eq(jobs.organizationId, orgId));
        await db.delete(orgs).where(eq(orgs.id, orgId));
    });

    it('should set an app as published', async () => {
        const publicSlug = 'my-published-app-' + Date.now();
        const updated = await AppDeploymentService.updateDeploymentPublishing(testAppId, orgId, {
            publicSlug,
            isPublished: true,
            title: 'My Published App',
            description: 'This is a test',
            accessPolicy: 'public'
        });

        expect(updated.publicSlug).toBe(publicSlug);
        expect(updated.isPublished).toBe(true);
        expect(updated.title).toBe('My Published App');
    });

    it('should retrieve a published app by slug', async () => {
        const publicSlug = 'get-published-app-' + Date.now();
        await AppDeploymentService.updateDeploymentPublishing(testAppId, orgId, {
            publicSlug,
            isPublished: true,
            title: 'My Published App',
            accessPolicy: 'public'
        });

        const deploymentInfo: any = await AppDeploymentService.getPublicDeployment(publicSlug);
        expect(deploymentInfo.deployment.title).toBe('My Published App');
        expect(deploymentInfo.app.id).toBe(testAppId);
    });

    it('should prevent retrieving an unpublished app', async () => {
        const publicSlug = 'unpub-app-' + Date.now();
        await AppDeploymentService.updateDeploymentPublishing(testAppId, orgId, {
            publicSlug,
            isPublished: false,
            accessPolicy: 'public'
        });

        await expect(AppDeploymentService.getPublicDeployment(publicSlug)).rejects.toThrow("App deployment not found or not published");
    });

    it.skip('should enforce password protection for password protected apps', async () => {
        const publicSlug = 'pw-app-' + Date.now();
        const pwd = "my-secret-password";
        const hashed = await hashPassword(pwd);

        await db.update(appDeployments).set({
            publicSlug,
            isPublished: true,
            accessPolicy: 'password',
            accessPasswordHash: hashed
        }).where(eq(appDeployments.id, testDeploymentId));

        await expect(AppDeploymentService.getPublicDeployment(publicSlug)).rejects.toThrow("Password required to access this application");
    });
});
