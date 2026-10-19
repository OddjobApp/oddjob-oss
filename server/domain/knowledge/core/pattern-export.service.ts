/**
 * Pattern Export/Import Service
 * Allows sharing learned patterns across organizations
 */

import { db } from "@server/database_service.js";
import { 
  knowledgeNodes 
} from "@shared/schema/index.js";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { BUILTIN_ERROR_PATTERNS, type ErrorPattern, type ErrorFix } from '@shared/utils/errorKnowledgeBase.js';

const logger = createLogger('PatternExportService');

// Export format version for compatibility
const EXPORT_FORMAT_VERSION = '1.0';

export interface PatternExport {
    version: string;
    exportedAt: string;
    exportedBy?: string;
    organizationName?: string;
    patterns: ExportedPattern[];
    metadata: {
        totalPatterns: number;
        categories: string[];
    };
}

export interface ExportedPattern {
    id: string;
    category: string;
    name: string;
    description?: string;
    triggers: Array<{
        type: 'status' | 'output_contains' | 'url_contains' | 'job_type' | 'regex' | 'error_code';
        value: string | number;
        weight?: number;
    }>;
    diagnosis: {
        summary: string;
        explanation: string;
        rootCause?: string;
    };
    fixes: Array<{
        id: string;
        description: string;
        confidence: number;
        actionType: string;
    }>;
    stats?: {
        timesUsed: number;
        successRate: number;
        lastUsed?: string;
    };
}

export interface ImportResult {
    success: boolean;
    imported: number;
    skipped: number;
    errors: string[];
    patterns: Array<{ id: string; name: string; status: 'imported' | 'skipped' | 'error' }>;
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

export class PatternExportService {

    /**
     * Export patterns from an organization (or built-in patterns)
     */
    async exportPatterns(options: {
        organizationId?: number;
        includeBuiltin?: boolean;
        includeCustom?: boolean;
        categories?: string[];
    } = {}): Promise<PatternExport> {
        const {
            organizationId,
            includeBuiltin = true,
            includeCustom = true,
            categories,
        } = options;

        const patterns: ExportedPattern[] = [];

        // Include built-in patterns
        if (includeBuiltin) {
            for (const pattern of BUILTIN_ERROR_PATTERNS) {
                if (categories && !categories.includes(pattern.category)) continue;
                patterns.push(this.convertToExportFormat(pattern));
            }
        }

        // Include custom patterns from approved clusters
        if (includeCustom && organizationId) {
            const customPatterns = await this.getApprovedPatterns(organizationId);
            for (const pattern of customPatterns) {
                if (categories && !categories.includes(pattern.category)) continue;
                patterns.push(pattern);
            }
        }

        // Get unique categories
        const uniqueCategories = [...new Set(patterns.map(p => p.category))];

        return {
            version: EXPORT_FORMAT_VERSION,
            exportedAt: new Date().toISOString(),
            patterns,
            metadata: {
                totalPatterns: patterns.length,
                categories: uniqueCategories,
            },
        };
    }

    /**
     * Get custom patterns from approved clusters
     */
    private async getApprovedPatterns(organizationId: number): Promise<ExportedPattern[]> {
        const result = await db.execute(sql`
      SELECT suggested_pattern, error_count, created_at
      FROM error_clusters
      WHERE status = 'approved'
        AND (organization_id = ${organizationId} OR organization_id IS NULL)
    `);

        return ((result as any).rows || [])
            .map((row: any) => {
                const pattern = row.suggested_pattern;
                if (!pattern) return null;

                return {
                    id: pattern.id || `custom-${row.id}`,
                    category: pattern.category || 'unknown',
                    name: pattern.name || 'Unnamed Pattern',
                    triggers: pattern.triggers || [],
                    diagnosis: pattern.diagnosis || { summary: '', explanation: '' },
                    fixes: (pattern.fixes || []).map((f: any) => ({
                        id: f.id,
                        description: f.description,
                        confidence: f.confidence || 0.5,
                        actionType: f.action?.type || 'manual',
                    })),
                    stats: {
                        timesUsed: row.error_count || 0,
                        successRate: 0,
                    },
                };
            })
            .filter(Boolean);
    }

    /**
     * Convert internal pattern format to export format
     */
    private convertToExportFormat(pattern: ErrorPattern): ExportedPattern {
        return {
            id: pattern.id,
            category: pattern.category,
            name: pattern.name,
            triggers: pattern.triggers.map((t: any) => ({
                type: t.type as ExportedPattern['triggers'][number]['type'],
                value: t.value,
                weight: t.weight,
            })),
            diagnosis: {
                summary: pattern.diagnosis.summary,
                explanation: pattern.diagnosis.explanation,
                rootCause: pattern.diagnosis.rootCause,
            },
            fixes: pattern.fixes.map((f: any) => ({
                id: f.id,
                description: f.description,
                confidence: f.confidence,
                actionType: f.action.type,
            })),
        };
    }

    /**
     * Validate import file format
     */
    validateImportFormat(data: any): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Check required fields
        if (!data.version) {
            errors.push('Missing version field');
        } else if (data.version !== EXPORT_FORMAT_VERSION) {
            warnings.push(`Version mismatch: expected ${EXPORT_FORMAT_VERSION}, got ${data.version}`);
        }

        if (!data.patterns || !Array.isArray(data.patterns)) {
            errors.push('Missing or invalid patterns array');
            return { valid: false, errors, warnings };
        }

        // Validate each pattern
        for (let i = 0; i < data.patterns.length; i++) {
            const pattern = data.patterns[i];
            const prefix = `Pattern ${i + 1}`;

            if (!pattern.id) errors.push(`${prefix}: Missing id`);
            if (!pattern.name) errors.push(`${prefix}: Missing name`);
            if (!pattern.category) warnings.push(`${prefix}: Missing category, will default to 'unknown'`);
            if (!pattern.triggers || !Array.isArray(pattern.triggers)) {
                warnings.push(`${prefix}: Missing triggers array`);
            }
            if (!pattern.diagnosis) {
                errors.push(`${prefix}: Missing diagnosis`);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
    }

    /**
     * Import patterns into organization
     */
    async importPatterns(
        data: PatternExport,
        organizationId: number,
        options: {
            overwriteExisting?: boolean;
            importerId?: string;
        } = {}
    ): Promise<ImportResult> {
        const { overwriteExisting = false, importerId } = options;

        const result: ImportResult = {
            success: true,
            imported: 0,
            skipped: 0,
            errors: [],
            patterns: [],
        };

        // Validate format
        const validation = this.validateImportFormat(data);
        if (!validation.valid) {
            return {
                ...result,
                success: false,
                errors: validation.errors,
            };
        }

        // Check for existing patterns
        const existingIds = await this.getExistingPatternIds(organizationId);

        for (const pattern of data.patterns) {
            try {
                // Skip built-in patterns
                if (BUILTIN_ERROR_PATTERNS.some((p: any) => p.id === pattern.id)) {
                    result.skipped++;
                    result.patterns.push({ id: pattern.id, name: pattern.name, status: 'skipped' });
                    continue;
                }

                // Check if already exists
                if (existingIds.has(pattern.id) && !overwriteExisting) {
                    result.skipped++;
                    result.patterns.push({ id: pattern.id, name: pattern.name, status: 'skipped' });
                    continue;
                }

                // Convert to internal format and store
                await this.storeImportedPattern(pattern, organizationId, importerId);

                result.imported++;
                result.patterns.push({ id: pattern.id, name: pattern.name, status: 'imported' });

            } catch (error: any) {
                result.errors.push(`Failed to import ${pattern.id}: ${error.message}`);
                result.patterns.push({ id: pattern.id, name: pattern.name, status: 'error' });
            }
        }

        logger.info('Pattern import complete', {
            organizationId,
            imported: result.imported,
            skipped: result.skipped,
            errors: result.errors.length,
        });

        return result;
    }

    /**
     * Get existing pattern IDs for an organization
     */
    private async getExistingPatternIds(organizationId: number): Promise<Set<string>> {
        const result = await db.execute(sql`
      SELECT suggested_pattern->>'id' as pattern_id
      FROM error_clusters
      WHERE status = 'approved'
        AND (organization_id = ${organizationId} OR organization_id IS NULL)
        AND suggested_pattern->>'id' IS NOT NULL
    `);

        return new Set(((result as any).rows || []).map((r: any) => r.pattern_id));
    }

    /**
     * Store an imported pattern
     */
    private async storeImportedPattern(
        pattern: ExportedPattern,
        organizationId: number,
        importerId?: string
    ): Promise<void> {
        // Convert to full ErrorPattern format
        const fullPattern = {
            id: pattern.id,
            category: pattern.category,
            name: pattern.name,
            isBuiltin: false,
            triggers: pattern.triggers,
            diagnosis: pattern.diagnosis,
            fixes: pattern.fixes.map(f => ({
                id: f.id,
                description: f.description,
                confidence: f.confidence,
                action: { type: f.actionType as any, instructions: f.description },
            })),
        };

        // Store as an approved cluster
        await db.execute(sql`
      INSERT INTO error_clusters (
        name, 
        suggested_pattern, 
        status, 
        organization_id, 
        reviewed_by, 
        reviewed_at,
        error_count
      ) VALUES (
        ${pattern.name},
        ${JSON.stringify(fullPattern)}::jsonb,
        'approved',
        ${organizationId},
        ${importerId || 'import'},
        NOW(),
        ${pattern.stats?.timesUsed || 0}
      )
      ON CONFLICT DO NOTHING
    `);
    }

    /**
     * Get all patterns (built-in + custom) for an organization
     */
    async getAllPatterns(organizationId?: number): Promise<ExportedPattern[]> {
        const exportData = await this.exportPatterns({
            organizationId,
            includeBuiltin: true,
            includeCustom: true,
        });

        return exportData.patterns;
    }

    /**
     * Delete a custom pattern
     */
    async deletePattern(patternId: string, organizationId: number): Promise<boolean> {
        // Can't delete built-in patterns
        if (BUILTIN_ERROR_PATTERNS.some((p: any) => p.id === patternId)) {
            return false;
        }

        const result = await db.execute(sql`
      DELETE FROM error_clusters
      WHERE suggested_pattern->>'id' = ${patternId}
        AND organization_id = ${organizationId}
      RETURNING id
    `);

        return ((result as any).rows?.length || 0) > 0;
    }
}

// Singleton instance
export const patternExportService = new PatternExportService();


