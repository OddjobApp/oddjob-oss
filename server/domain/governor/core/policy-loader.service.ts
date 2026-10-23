import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { db } from '@server/database_service.js';
import { governorPolicies, governorPolicyRules } from '@shared/schema/index.js';
import { createLogger } from '@server/utils/logger.js';
import { eq, and } from 'drizzle-orm';

const logger = createLogger('PolicyLoader');

interface YamlRule {
    type: string;
    configuration: any;
}

interface YamlPolicy {
    name: string;
    description?: string;
    rules: YamlRule[];
}

export class PolicyLoaderService {
    private readonly policiesDir: string;

    constructor() {
        // Resolve path to server/config/policies
        this.policiesDir = path.join(process.cwd(), 'server', 'config', 'policies');
    }

    /**
     * Synchronizes YAML policies with the database.
     */
    async syncAllPolicies(): Promise<void> {
        logger.info(`Starting YAML capability manager sync from ${this.policiesDir}...`);
        
        // Nothing to sync. Creating the directory here failed on every production
        // boot (the image's code tree is read-only to the app user) and an empty
        // directory would have synced nothing anyway.
        if (!fs.existsSync(this.policiesDir)) {
            logger.info(`No YAML policies deployed (${this.policiesDir} is absent); policies are managed in the database.`);
            return;
        }

        const files = fs.readdirSync(this.policiesDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        
        let successCount = 0;
        let failCount = 0;

        for (const file of files) {
            const filePath = path.join(this.policiesDir, file);
            try {
                // ${PROJECT_ROOT} lets a policy name this checkout without
                // hard-coding one developer's absolute path into it.
                const projectRoot = process.cwd().replace(/\\/g, '/');
                const fileContents = fs.readFileSync(filePath, 'utf8').split('${PROJECT_ROOT}').join(projectRoot);
                const parsed = yaml.load(fileContents) as { policies?: YamlPolicy[] };
                
                if (parsed && Array.isArray(parsed.policies)) {
                    for (const yamlPolicy of parsed.policies) {
                        await this.upsertPolicy(yamlPolicy);
                        successCount++;
                    }
                } else {
                    logger.warn(`File ${file} does not contain a valid 'policies' array.`);
                }
            } catch (err: any) {
                logger.error(`Failed to parse or sync policy file ${file}:`, err);
                failCount++;
            }
        }

        logger.info(`Policy sync complete. Synced: ${successCount}, Failed: ${failCount}`);
    }

    private async upsertPolicy(yamlPolicy: YamlPolicy): Promise<void> {
        await db.transaction(async (tx) => {
            // 1. Check if policy exists by name and type='system'
            const [existing] = await tx.select().from(governorPolicies).where(
                and(
                    eq(governorPolicies.name, yamlPolicy.name),
                    eq(governorPolicies.type, 'system')
                )
            ).limit(1);

            let policyId: number;

            if (existing) {
                // Update
                const [updated] = await tx.update(governorPolicies).set({
                    description: yamlPolicy.description,
                    updatedAt: new Date()
                }).where(eq(governorPolicies.id, existing.id)).returning();
                policyId = updated.id;
                
                // Delete existing rules so we can fully replace them
                await tx.delete(governorPolicyRules).where(eq(governorPolicyRules.policyId, policyId));
            } else {
                // Insert
                const [inserted] = await tx.insert(governorPolicies).values({
                    name: yamlPolicy.name,
                    description: yamlPolicy.description,
                    type: 'system',
                    createdBy: 'yaml_sync',
                    isActive: true
                } as any).returning();
                policyId = inserted.id;
            }

            // 2. Insert new rules
            if (yamlPolicy.rules && yamlPolicy.rules.length > 0) {
                const rulesToInsert = yamlPolicy.rules.map(r => ({
                    policyId,
                    type: r.type,
                    configuration: r.configuration,
                    isEnabled: true
                }));
                await tx.insert(governorPolicyRules).values(rulesToInsert as any);
            }
            
            logger.debug(`Synced YAML policy: ${yamlPolicy.name}`);
        });
    }
}

export const policyLoaderService = new PolicyLoaderService();
