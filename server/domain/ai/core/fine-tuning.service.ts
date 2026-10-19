import { db } from "@server/database_service.js";
import { fineTuningDatasets, fineTuningExamples, fineTuningPreferences, knowledgeNodes, insertFineTuningDatasetSchema, insertFineTuningExampleSchema } from "@shared/schema/index.js";
import { eq, desc, and, sql } from "drizzle-orm";
import { ValidationError, NotFoundError, ForbiddenError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger('FineTuningService');

export class FineTuningService {

    /**
     * List datasets with optional organization filtering
     */
    async listDatasets(organizationId?: number | null, isSuperAdmin: boolean = false) {
        const query = db.select({
            id: fineTuningDatasets.id,
            name: fineTuningDatasets.name,
            description: fineTuningDatasets.description,
            organizationId: fineTuningDatasets.organizationId,
            createdAt: fineTuningDatasets.createdAt,
            updatedAt: fineTuningDatasets.updatedAt,
            exampleCount: sql<number>`(SELECT COUNT(*) FROM "fine_tuning_examples" WHERE "fine_tuning_examples"."dataset_id" = "fine_tuning_datasets"."id")`
        }).from(fineTuningDatasets).orderBy(desc(fineTuningDatasets.createdAt));

        if (isSuperAdmin) {
            return await query;
        }

        if (organizationId) {
            return await db.select({
                id: fineTuningDatasets.id,
                name: fineTuningDatasets.name,
                description: fineTuningDatasets.description,
                organizationId: fineTuningDatasets.organizationId,
                createdAt: fineTuningDatasets.createdAt,
                updatedAt: fineTuningDatasets.updatedAt,
                exampleCount: sql<number>`(SELECT COUNT(*) FROM "fine_tuning_examples" WHERE "fine_tuning_examples"."dataset_id" = "fine_tuning_datasets"."id")`
            })
            .from(fineTuningDatasets)
            .where(eq(fineTuningDatasets.organizationId, organizationId))
            .orderBy(desc(fineTuningDatasets.createdAt));
        }

        return [];
    }

    /**
     * Create a new dataset and corresponding knowledge node
     */
    async createDataset(data: any, organizationId: number, userId?: string) {
        const validation = insertFineTuningDatasetSchema.safeParse(data);
        if (!validation.success) {
            throw new ValidationError("Invalid dataset data", validation.error.issues);
        }

        const { name, description } = validation.data;

        // Create Dataset
        const [dataset] = await db.insert(fineTuningDatasets).values({
            name,
            description: description || null,
            organizationId,
        }).returning();

        // Create Knowledge Node (side-effect)
        try {
            await db.insert(knowledgeNodes).values({
                organizationId,
                label: 'Dataset',
                name: dataset.name,
                externalId: `dataset-${dataset.id}`,
                data: {
                    description: dataset.description,
                    createdAt: dataset.createdAt,
                    type: 'fine-tuning'
                },
                verificationStatus: 'verified',
                confidenceScore: '1.0',
                createdBy: userId || null
            });
            logger.info('Created knowledge node for dataset', { datasetId: dataset.id });
        } catch (err: any) {
            logger.warn('Failed to create knowledge node for dataset', { datasetId: dataset.id, error: err.message });
        }

        return dataset;
    }

    /**
     * Delete a dataset and its knowledge node
     */
    async deleteDataset(id: number, organizationId?: number | null, isSuperAdmin: boolean = false) {
        // fetch first to check auth
        const [dataset] = await db.select().from(fineTuningDatasets).where(eq(fineTuningDatasets.id, id)).limit(1);
        if (!dataset) {
            throw new NotFoundError("Dataset not found", "NOT_FOUND", { datasetId: id });
        }

        if (!isSuperAdmin && dataset.organizationId !== organizationId) {
            throw new ForbiddenError("Access denied to this dataset");
        }

        // Delete dataset
        await db.delete(fineTuningDatasets).where(eq(fineTuningDatasets.id, id));

        // Delete knowledge node
        try {
            await db.delete(knowledgeNodes).where(and(
                eq(knowledgeNodes.externalId, `dataset-${id}`),
                eq(knowledgeNodes.label, 'Dataset')
            ));
            logger.info('Deleted knowledge node for dataset', { datasetId: id });
        } catch (err: any) {
            logger.warn('Failed to delete knowledge node for dataset', { datasetId: id, error: err.message });
        }
    }

    /**
     * Get a single dataset by ID
     */
    async getDataset(id: number, organizationId?: number | null, isSuperAdmin: boolean = false) {
        const [dataset] = await db.select().from(fineTuningDatasets).where(eq(fineTuningDatasets.id, id)).limit(1);
        if (!dataset) {
            throw new NotFoundError("Dataset not found", "NOT_FOUND", { datasetId: id });
        }

        if (!isSuperAdmin && dataset.organizationId !== organizationId) {
            throw new ForbiddenError("Access denied to this dataset");
        }

        return dataset;
    }

    /**
     * List examples for a dataset
     */
    async listExamples(datasetId: number, organizationId?: number | null, isSuperAdmin: boolean = false) {
        // Validate access first by fetching dataset
        await this.getDataset(datasetId, organizationId, isSuperAdmin);

        return await db.select()
            .from(fineTuningExamples)
            .where(eq(fineTuningExamples.datasetId, datasetId))
            .orderBy(desc(fineTuningExamples.createdAt));
    }

    /**
     * Create a new example
     */
    async createExample(datasetId: number, data: any, organizationId?: number | null, isSuperAdmin: boolean = false) {
        await this.getDataset(datasetId, organizationId, isSuperAdmin);

        const body = { ...data, datasetId };
        const validation = insertFineTuningExampleSchema.safeParse(body);
        if (!validation.success) {
            throw new ValidationError("Invalid example data", validation.error.issues);
        }

        const [example] = await db.insert(fineTuningExamples).values(validation.data).returning();
        return example;
    }

    /**
     * Import multiple examples (bulk / JSONL)
     */
    async importExamples(datasetId: number, data: any, organizationId?: number | null, isSuperAdmin: boolean = false) {
        await this.getDataset(datasetId, organizationId, isSuperAdmin);

        let examplesToInsert: any[] = [];

        if (Array.isArray(data)) {
            examplesToInsert = data.map(item => ({
                datasetId,
                input: typeof item.input === 'string' ? item.input : JSON.stringify(item.input),
                output: typeof item.output === 'string' ? item.output : JSON.stringify(item.output),
            }));
        } else if (typeof data === 'string') {
            const lines = data.split('\n');
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.messages && Array.isArray(parsed.messages)) {
                        const userMsg = parsed.messages.find((m: any) => m.role === 'user')?.content;
                        const assistantMsg = parsed.messages.find((m: any) => m.role === 'assistant')?.content;
                        if (userMsg && assistantMsg) {
                            examplesToInsert.push({ datasetId, input: userMsg, output: assistantMsg });
                        }
                    } else if (parsed.prompt && parsed.completion) {
                        examplesToInsert.push({ datasetId, input: parsed.prompt, output: parsed.completion });
                    } else if (parsed.input && parsed.output) {
                        examplesToInsert.push({ datasetId, input: parsed.input, output: parsed.output });
                    }
                } catch (e) {
                    // Ignore bad lines
                }
            }
        }

        if (examplesToInsert.length === 0) {
            throw new ValidationError("No valid examples found to import", {
                hint: "Provide data as an array of {input, output} objects or JSONL format"
            });
        }

        await db.insert(fineTuningExamples).values(examplesToInsert);
        return examplesToInsert.length;
    }

    /**
     * Export examples as JSONL in the requested provider format.
     *
     *   openai     -> { messages: [{role:"system"},{role:"user"},{role:"assistant"}] }
     *   anthropic  -> { system: "...", messages: [{role:"user"},{role:"assistant"}] }
     *   gemini     -> { systemInstruction: {parts:[{text}]}, contents: [{role:"user",parts},{role:"model",parts}] }
     *
     * Caller supplies the system message via systemPrompt; defaults to the
     * generic helpful-assistant string used historically.
     */
    async exportExamples(
        datasetId: number,
        organizationId?: number | null,
        isSuperAdmin: boolean = false,
        format: 'openai' | 'anthropic' | 'gemini' = 'openai',
        systemPrompt: string = "You are a helpful AI assistant."
    ) {
        const examples = await this.listExamples(datasetId, organizationId, isSuperAdmin);

        const jsonlParts = examples.map(ex => {
            const obj = formatExampleForProvider(format, systemPrompt, ex.input, ex.output);
            return JSON.stringify(obj);
        });

        return {
            data: jsonlParts.join('\n'),
            count: examples.length,
            format,
        };
    }

    /**
     * Get aggregate stats for fine-tuning
     */
    async getStats(organizationId?: number | null, isSuperAdmin: boolean = false) {
        const conditions = [];
        if (!isSuperAdmin && organizationId) {
            conditions.push(eq(fineTuningDatasets.organizationId, organizationId));
        }

        const [datasetsCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(fineTuningDatasets).where(and(...conditions));
        
        // Count examples across allowed datasets
        const examplesCountQuery = db.select({ count: sql<number>`COUNT(*)` })
            .from(fineTuningExamples)
            .innerJoin(fineTuningDatasets, eq(fineTuningExamples.datasetId, fineTuningDatasets.id));
        
        if (!isSuperAdmin && organizationId) {
            examplesCountQuery.where(eq(fineTuningDatasets.organizationId, organizationId));
        }
        
        const [examplesCount] = await examplesCountQuery;

        return {
            totalDatasets: Number(datasetsCount?.count || 0),
            totalExamples: Number(examplesCount?.count || 0),
            activeTraining: 0, // Placeholder for real training engine state
            adaptersDeployed: 0, // Placeholder for model deployment state
        };
    }

    /**
     * Start a simulated training job
     */
    async startTraining(datasetId: number, config: any, organizationId: number, isSuperAdmin: boolean = false) {
        const dataset = await this.getDataset(datasetId, organizationId, isSuperAdmin);
        
        // In a real system, this would trigger a GPU worker / Modal / SageMaker
        // Here we create a "training_run" record (simulated)
        const runId = `train-${Math.random().toString(36).slice(2, 11)}`;
        
        logger.info('Starting simulated training run', { datasetId, runId, config });
        
        // For simulation, we'll just return the metadata
        // The UI will poll or use event stream
        return {
            runId,
            status: 'queued',
            datasetName: dataset.name,
            config,
            etaSeconds: 300
        };
    }

    /**
     * Helper to find or create a dataset by name and register an example.
     * Used for automated feedback loops (e.g., App Forge auto-fixes).
     */
    async registerExample(
        datasetName: string,
        example: { input: string, output: string, inputContext?: any, tags?: string[], humanConfidence?: number, sourceJobId?: number },
        organizationId: number
    ) {
        try {
            const dataset = await this.findOrCreateAutomatedDataset(datasetName, organizationId);
            const [newExample] = await db.insert(fineTuningExamples).values({
                datasetId: dataset.id,
                input: example.input,
                output: example.output,
                inputContext: example.inputContext || {},
                tags: example.tags || [],
                humanConfidence: example.humanConfidence ?? 100,
                sourceJobId: example.sourceJobId ?? null,
            }).returning();

            return newExample;
        } catch (err: any) {
            logger.warn('Failed to register automated fine-tuning example', { error: err.message });
            return null;
        }
    }

    /**
     * Register a DPO/preference sample (chosen vs rejected) into an automated
     * dataset. Mirrors registerExample's find-or-create pattern. Used by the
     * eval feedback loop when a test fails but we know the expected answer.
     */
    async registerPreference(
        datasetName: string,
        preference: { prompt: string, chosenResponse: string, rejectedResponse: string, humanConfidence?: number, sourceJobId?: number },
        organizationId: number
    ) {
        try {
            const dataset = await this.findOrCreateAutomatedDataset(datasetName, organizationId);
            const [newPref] = await db.insert(fineTuningPreferences).values({
                datasetId: dataset.id,
                prompt: preference.prompt,
                chosenResponse: preference.chosenResponse,
                rejectedResponse: preference.rejectedResponse,
                humanConfidence: preference.humanConfidence ?? 80,
                sourceJobId: preference.sourceJobId ?? null,
            }).returning();
            return newPref;
        } catch (err: any) {
            logger.warn('Failed to register automated fine-tuning preference', { error: err.message });
            return null;
        }
    }

    /**
     * Find an automated dataset by (name, org) or create it. Internal helper
     * shared by registerExample and registerPreference so both write to the
     * same dataset when called with the same name.
     */
    private async findOrCreateAutomatedDataset(name: string, organizationId: number) {
        const [existing] = await db.select()
            .from(fineTuningDatasets)
            .where(and(
                eq(fineTuningDatasets.name, name),
                eq(fineTuningDatasets.organizationId, organizationId)
            ))
            .limit(1);
        if (existing) return existing;

        const [created] = await db.insert(fineTuningDatasets).values({
            name,
            description: `Automated dataset for ${name}`,
            organizationId,
        }).returning();
        logger.info('Created automated fine-tuning dataset', { datasetName: name, organizationId });
        return created;
    }
}

export const fineTuningService = new FineTuningService();

/**
 * Format a single input/output pair for the target provider's fine-tuning
 * JSONL spec. Kept as a module-level helper so it's pure and unit-testable.
 *
 * Note: Gemini uses role "model" for assistant turns (not "assistant"), and
 * Anthropic puts the system message at the top level (not in messages).
 */
function formatExampleForProvider(
    format: 'openai' | 'anthropic' | 'gemini',
    systemPrompt: string,
    input: string,
    output: string,
): Record<string, unknown> {
    switch (format) {
        case 'anthropic':
            return {
                system: systemPrompt,
                messages: [
                    { role: 'user', content: input },
                    { role: 'assistant', content: output },
                ],
            };
        case 'gemini':
            return {
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [
                    { role: 'user', parts: [{ text: input }] },
                    { role: 'model', parts: [{ text: output }] },
                ],
            };
        case 'openai':
        default:
            return {
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: input },
                    { role: 'assistant', content: output },
                ],
            };
    }
}


