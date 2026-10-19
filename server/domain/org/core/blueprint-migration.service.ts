import { db } from "@server/database_service.js";
import { eq, and, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { operationalCycles, orgSettings } from "@shared/schema/index.js";
import yaml from "js-yaml";

const logger = createLogger("BlueprintMigrationService");

/**
 * Blueprint version information
 */
interface BlueprintVersion {
    version: string;
    schemaVersion: string;
    migrationDate: Date;
    changes: string[];
    breaking: boolean;
}

/**
 * Migration script interface
 */
interface MigrationScript {
    fromVersion: string;
    toVersion: string;
    up: (orgId: number) => Promise<void>;
    down: (orgId: number) => Promise<void>;
    description: string;
    changes: string[];
    breaking: boolean;
}

/**
 * Blueprint Migration Service
 * Handles versioning and migration of blueprints
 */
export class BlueprintMigrationService {
    private static instance: BlueprintMigrationService;
    private migrations: Map<string, MigrationScript> = new Map();
    private versionHistory: Map<number, BlueprintVersion[]> = new Map();

    private constructor() {
        this.registerMigrations();
    }

    static getInstance(): BlueprintMigrationService {
        if (!BlueprintMigrationService.instance) {
            BlueprintMigrationService.instance = new BlueprintMigrationService();
        }
        return BlueprintMigrationService.instance;
    }

    /**
     * Register migration scripts
     */
    private registerMigrations(): void {
        // Migration 1.0.0 -> 1.1.0
        this.registerMigration({
            fromVersion: "1.0.0",
            toVersion: "1.1.0",
            description: "Add AI provider and knowledge graph configuration",
            breaking: false,
            changes: [
                "Added ai_provider configuration section",
                "Added knowledge_graph configuration section",
                "Added MCP servers configuration"
            ],
            up: async (orgId: number) => {
                logger.info(`[Migration] Upgrading org ${orgId} from 1.0.0 to 1.1.0`);
                // Migration logic handled by normal blueprint installation
            },
            down: async (orgId: number) => {
                logger.info(`[Migration] Downgrading org ${orgId} from 1.1.0 to 1.0.0`);
                // Remove AI provider, knowledge graph, MCP configs from org settings
            }
        });

        // Migration 1.1.0 -> 1.2.0
        this.registerMigration({
            fromVersion: "1.1.0",
            toVersion: "1.2.0",
            description: "Add observability and quality gates",
            breaking: false,
            changes: [
                "Added observability configuration",
                "Added quality gates configuration",
                "Added deployment configuration"
            ],
            up: async (orgId: number) => {
                logger.info(`[Migration] Upgrading org ${orgId} from 1.1.0 to 1.2.0`);
            },
            down: async (orgId: number) => {
                logger.info(`[Migration] Downgrading org ${orgId} from 1.2.0 to 1.1.0`);
            }
        });

        // Migration 1.2.0 -> 2.0.0
        this.registerMigration({
            fromVersion: "1.2.0",
            toVersion: "2.0.0",
            description: "Add workbenches, event bus, and customization framework",
            breaking: true,
            changes: [
                "Added 5 workbench apps (PM, Scrum Master, QA, Stakeholder, AI Workforce)",
                "Added cross-app event bus infrastructure",
                "Added customization framework for apps and org",
                "Added human roles configuration",
                "Added advanced security and compliance features"
            ],
            up: async (orgId: number) => {
                logger.info(`[Migration] Upgrading org ${orgId} from 1.2.0 to 2.0.0`);
                // Enable event bus in org settings
                await db.update(orgSettings)
                    .set({
                        eventBusEnabled: true,
                        customizationEnabled: true,
                        updatedAt: new Date()
                    } as any)
                    .where(eq(orgSettings.organizationId, orgId));
            },
            down: async (orgId: number) => {
                logger.info(`[Migration] Downgrading org ${orgId} from 2.0.0 to 1.2.0`);
                // Disable event bus and customization
                await db.update(orgSettings)
                    .set({
                        eventBusEnabled: false,
                        customizationEnabled: false,
                        updatedAt: new Date()
                    } as any)
                    .where(eq(orgSettings.organizationId, orgId));
            }
        });
    }

    /**
     * Register a migration script
     */
    private registerMigration(migration: MigrationScript): void {
        const key = `${migration.fromVersion}->${migration.toVersion}`;
        this.migrations.set(key, migration);
        logger.info(`[Migration] Registered migration: ${key}`);
    }

    /**
     * Get current blueprint version for an organization
     */
    async getCurrentVersion(orgId: number, blueprintName: string): Promise<string | null> {
        try {
            const [cycle] = await db.select()
                .from(operationalCycles)
                .where(and(
                    eq(operationalCycles.organizationId, orgId),
                    eq(operationalCycles.name, blueprintName)
                ))
                .limit(1);

            if (!cycle) return null;

            const metadata = cycle.metadata as any;
            return metadata?.version || "1.0.0";
        } catch (error) {
            logger.error(`[Migration] Error getting current version:`, error);
            return null;
        }
    }

    /**
     * Check if migration is needed
     */
    async needsMigration(orgId: number, blueprintName: string, targetVersion: string): Promise<boolean> {
        const currentVersion = await this.getCurrentVersion(orgId, blueprintName);
        if (!currentVersion) return false;

        return this.compareVersions(currentVersion, targetVersion) < 0;
    }

    /**
     * Migrate blueprint to target version
     */
    async migrate(orgId: number, blueprintName: string, targetVersion: string): Promise<void> {
        const currentVersion = await this.getCurrentVersion(orgId, blueprintName);
        if (!currentVersion) {
            throw new Error(`No current version found for blueprint ${blueprintName}`);
        }

        if (this.compareVersions(currentVersion, targetVersion) >= 0) {
            logger.info(`[Migration] Blueprint ${blueprintName} already at version ${currentVersion}`);
            return;
        }

        logger.info(`[Migration] Migrating ${blueprintName} from ${currentVersion} to ${targetVersion}`);

        // Find migration path
        const path = this.findMigrationPath(currentVersion, targetVersion);
        if (!path) {
            throw new Error(`No migration path from ${currentVersion} to ${targetVersion}`);
        }

        // Execute migrations in sequence
        for (const migration of path) {
            logger.info(`[Migration] Executing migration: ${migration.fromVersion} -> ${migration.toVersion}`);
            
            try {
                await migration.up(orgId);
                
                // Record version in history
                this.recordVersion(orgId, {
                    version: migration.toVersion,
                    schemaVersion: migration.toVersion,
                    migrationDate: new Date(),
                    changes: migration.changes,
                    breaking: migration.breaking
                });
            } catch (error) {
                logger.error(`[Migration] Failed to execute migration:`, error);
                throw error;
            }
        }

        // Update cycle metadata with new version
        await db.update(operationalCycles)
            .set({
                metadata: sql`jsonb_set(
                    COALESCE(metadata, '{}'::jsonb),
                    '{version}',
                    ${JSON.stringify(targetVersion)}::jsonb
                )`,
                updatedAt: new Date()
            })
            .where(and(
                eq(operationalCycles.organizationId, orgId),
                eq(operationalCycles.name, blueprintName)
            ));

        logger.info(`[Migration] Successfully migrated ${blueprintName} to ${targetVersion}`);
    }

    /**
     * Rollback to previous version
     */
    async rollback(orgId: number, blueprintName: string, targetVersion: string): Promise<void> {
        const currentVersion = await this.getCurrentVersion(orgId, blueprintName);
        if (!currentVersion) {
            throw new Error(`No current version found for blueprint ${blueprintName}`);
        }

        if (this.compareVersions(currentVersion, targetVersion) <= 0) {
            throw new Error(`Cannot rollback to ${targetVersion} (current: ${currentVersion})`);
        }

        logger.info(`[Migration] Rolling back ${blueprintName} from ${currentVersion} to ${targetVersion}`);

        // Find rollback path
        const path = this.findRollbackPath(currentVersion, targetVersion);
        if (!path) {
            throw new Error(`No rollback path from ${currentVersion} to ${targetVersion}`);
        }

        // Execute rollbacks in reverse sequence
        for (const migration of path.reverse()) {
            logger.info(`[Migration] Executing rollback: ${migration.toVersion} -> ${migration.fromVersion}`);
            
            try {
                await migration.down(orgId);
            } catch (error) {
                logger.error(`[Migration] Failed to execute rollback:`, error);
                throw error;
            }
        }

        // Update cycle metadata with rolled back version
        await db.update(operationalCycles)
            .set({
                metadata: sql`jsonb_set(
                    COALESCE(metadata, '{}'::jsonb),
                    '{version}',
                    ${JSON.stringify(targetVersion)}::jsonb
                )`,
                updatedAt: new Date()
            })
            .where(and(
                eq(operationalCycles.organizationId, orgId),
                eq(operationalCycles.name, blueprintName)
            ));

        logger.info(`[Migration] Successfully rolled back ${blueprintName} to ${targetVersion}`);
    }

    /**
     * Find migration path between versions
     */
    private findMigrationPath(fromVersion: string, toVersion: string): MigrationScript[] {
        const path: MigrationScript[] = [];
        let current = fromVersion;

        while (this.compareVersions(current, toVersion) < 0) {
            const key = `${current}->${this.getNextVersion(current)}`;
            const migration = this.migrations.get(key);
            
            if (!migration) {
                return []; // No path found
            }

            path.push(migration);
            current = migration.toVersion;
        }

        return path;
    }

    /**
     * Find rollback path between versions
     */
    private findRollbackPath(fromVersion: string, toVersion: string): MigrationScript[] {
        const path: MigrationScript[] = [];
        let current = fromVersion;

        while (this.compareVersions(current, toVersion) > 0) {
            const key = `${this.getPreviousVersion(current)}->${current}`;
            const migration = this.migrations.get(key);
            
            if (!migration) {
                return []; // No path found
            }

            path.push(migration);
            current = migration.fromVersion;
        }

        return path;
    }

    /**
     * Get next version in sequence
     */
    private getNextVersion(version: string): string {
        const versions = Array.from(this.migrations.values())
            .map(m => m.toVersion)
            .filter(v => this.compareVersions(v, version) > 0)
            .sort((a, b) => this.compareVersions(a, b));

        return versions[0] || version;
    }

    /**
     * Get previous version in sequence
     */
    private getPreviousVersion(version: string): string {
        const versions = Array.from(this.migrations.values())
            .map(m => m.fromVersion)
            .filter(v => this.compareVersions(v, version) < 0)
            .sort((a, b) => this.compareVersions(b, a));

        return versions[0] || version;
    }

    /**
     * Compare semantic versions
     * Returns -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
     */
    private compareVersions(v1: string, v2: string): number {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);

        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;

            if (p1 < p2) return -1;
            if (p1 > p2) return 1;
        }

        return 0;
    }

    /**
     * Record version in history
     */
    private recordVersion(orgId: number, version: BlueprintVersion): void {
        const history = this.versionHistory.get(orgId) || [];
        history.push(version);
        this.versionHistory.set(orgId, history);
    }

    /**
     * Get version history for organization
     */
    getVersionHistory(orgId: number): BlueprintVersion[] {
        return this.versionHistory.get(orgId) || [];
    }

    /**
     * Validate blueprint YAML for compatibility
     */
    validateBlueprintCompatibility(yamlContent: string, currentVersion: string): { compatible: boolean; issues: string[] } {
        try {
            const manifest = yaml.load(yamlContent) as any;
            const targetVersion = manifest.version || "1.0.0";

            const issues: string[] = [];

            // Check if target version is supported
            const supportedVersions = Array.from(this.migrations.values())
                .map(m => m.toVersion)
                .concat(Array.from(this.migrations.values()).map(m => m.fromVersion));

            if (!supportedVersions.includes(targetVersion)) {
                issues.push(`Target version ${targetVersion} is not supported`);
            }

            // Check for breaking changes
            const path = this.findMigrationPath(currentVersion, targetVersion);
            if (path.some(m => m.breaking)) {
                issues.push(`Migration path contains breaking changes`);
            }

            return {
                compatible: issues.length === 0,
                issues
            };
        } catch (error) {
            return {
                compatible: false,
                issues: ["Invalid YAML format"]
            };
        }
    }
}

export const blueprintMigrationService = BlueprintMigrationService.getInstance();
