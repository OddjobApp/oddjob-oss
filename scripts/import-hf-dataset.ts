import "dotenv/config";
import { db } from "../server/database_service.js";
import { fineTuningDatasets, fineTuningExamples } from "../shared/schema/training.js";
import { knowledgeNodes } from "../shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createLogger } from "../server/utils/logger.js";

const logger = createLogger("ImportHFDataset");

interface HFDatasetRow {
    input?: string;
    output?: string;
    prompt?: string;
    response?: string;
    system?: string;
    instruction?: string;
    chosen?: string;
    rejected?: string;
    [key: string]: any;
}

/**
 * Script to download and import Hugging Face datasets for Agentic Maturity Fine-Tuning & Knowledge Graph.
 * Usage: npx tsx scripts/import-hf-dataset.ts <hf-dataset-name> [split] [limit]
 * Example: npx tsx scripts/import-hf-dataset.ts glaiveai/glaive-function-calling-v2 train 50
 */
async function importHuggingFaceDataset(
    datasetName: string = "glaiveai/glaive-function-calling-v2",
    split: string = "train",
    limit: number = 50,
    orgId: number = 1
) {
    logger.info(`🚀 Fetching Hugging Face Dataset: "${datasetName}" (split: ${split}, limit: ${limit})...`);

    try {
        // 1. Fetch dataset rows via the HF datasets-server, one page at a time.
        //
        // `length` is capped at 100 per request — anything larger is refused
        // with a 422, so passing `limit` straight through meant this script
        // silently could not import more than a hundred rows, and failed
        // outright if you asked for more. Paginate instead.
        const PAGE_SIZE = 100;
        const rows: Array<{ row: HFDatasetRow }> = [];

        const fetchPage = async (offset: number, length: number): Promise<any> => {
            const base = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(datasetName)}`;
            const withConfig = `${base}&config=default&split=${split}&offset=${offset}&length=${length}`;
            const response = await fetch(withConfig);
            if (response.ok) return response.json();

            // Fallback for datasets whose config is not named "default".
            const altResp = await fetch(`${base}&split=${split}&offset=${offset}&length=${length}`);
            if (!altResp.ok) {
                throw new Error(
                    `Failed to fetch Hugging Face dataset rows: ${altResp.statusText} (${altResp.status})`,
                );
            }
            return altResp.json();
        };

        let data: any = null;
        while (rows.length < limit) {
            const page = await fetchPage(rows.length, Math.min(PAGE_SIZE, limit - rows.length));
            data ??= page;
            const pageRows: Array<{ row: HFDatasetRow }> = page.rows ?? [];
            if (pageRows.length === 0) break; // dataset exhausted before the limit
            rows.push(...pageRows);
            if (pageRows.length < PAGE_SIZE) break;
            logger.info(`   …fetched ${rows.length}/${limit}`);
        }
        logger.info(`✅ Downloaded ${rows.length} rows from Hugging Face dataset "${datasetName}".`);
        if (rows.length > 0) {
            console.log("Sample HF Row Keys:", Object.keys(rows[0].row), JSON.stringify(rows[0].row).slice(0, 300));
        }

        // 2. Ensure dataset record in Oddjob DB
        let [targetDataset] = await db.select()
            .from(fineTuningDatasets)
            .where(and(eq(fineTuningDatasets.name, datasetName), eq(fineTuningDatasets.organizationId, orgId)))
            .limit(1);

        if (!targetDataset) {
            [targetDataset] = await db.insert(fineTuningDatasets).values({
                name: datasetName,
                description: `Hugging Face Dataset ingested for Agentic Maturity fine-tuning & evaluation. Source: https://huggingface.co/datasets/${datasetName}`,
                organizationId: orgId,
            }).returning();

            // Auto-create Knowledge Node for Knowledge Graph visualization
            // knowledge_nodes stores its payload in `data`; it has no
            // organizationId/title/content/metadata columns.
            await db.insert(knowledgeNodes).values({
                label: "Dataset",
                name: `HF Dataset: ${datasetName}`,
                data: {
                    organizationId: orgId,
                    description: `Hugging Face dataset ingested for agentic maturity. Features ${rows.length} records.`,
                    source: "huggingface",
                    datasetName,
                    split,
                    itemCount: rows.length,
                }
            }).catch(() => {});

            logger.info(`✅ Created new Fine-Tuning Dataset record (ID: ${targetDataset.id}) and Knowledge Node.`);
        }

        // 3. Process and store examples
        let insertedCount = 0;
        for (const item of rows) {
            const r = item.row;

            let systemPrompt = r.system || r.system_prompt || "You are an autonomous AI agent.";
            let inputContent = "";
            let outputContent = "";

            if (r.chat) {
                if (typeof r.chat === "string") {
                    const parts = r.chat.split(/(USER:|ASSISTANT:)/g);
                    let currentRole = "";
                    let uText = "";
                    let aText = "";
                    for (let i = 0; i < parts.length; i++) {
                        const token = parts[i].trim();
                        if (token === "USER:") {
                            currentRole = "user";
                        } else if (token === "ASSISTANT:") {
                            currentRole = "assistant";
                        } else if (token) {
                            if (currentRole === "user") uText += (uText ? "\n" : "") + token;
                            if (currentRole === "assistant") aText += (aText ? "\n" : "") + token;
                        }
                    }
                    inputContent = uText || r.chat;
                    outputContent = aText || r.chat;
                } else if (Array.isArray(r.chat)) {
                    const userMsgs: string[] = [];
                    const assistantMsgs: string[] = [];
                    for (const m of r.chat) {
                        const role = m.role || m.from || "";
                        const text = m.content || m.value || m.text || "";
                        if (role === "system") {
                            systemPrompt = text;
                        } else if (role === "user" || role === "human") {
                            userMsgs.push(text);
                        } else if (role === "assistant" || role === "gpt") {
                            assistantMsgs.push(text);
                        }
                    }
                    inputContent = userMsgs.join("\n---\n");
                    outputContent = assistantMsgs.join("\n---\n");
                }
            } else {
                // sql_prompt / sql_context / sql is the text-to-SQL shape (e.g.
                // gretelai/synthetic_text_to_sql). Without it, 300 downloaded
                // rows mapped to zero examples — a dataset record with nothing
                // in it and a success line in the log.
                const sqlPrompt = r.sql_prompt
                    ? `${r.sql_prompt}${r.sql_context ? `\n\nSchema:\n${r.sql_context}` : ""}`
                    : "";

                inputContent = r.input || r.prompt || r.instruction || r.question || r.confirmed_task || sqlPrompt || (typeof r === "object" ? JSON.stringify(r) : String(r));
                outputContent = r.output || r.response || r.answer || r.completion || r.sql || (Array.isArray(r.action_reprs) ? r.action_reprs.join("\n") : r.action_reprs) || "";
            }

            if (inputContent && outputContent) {
                // fine_tuning_examples carries only datasetId/input/output plus
                // inputContext, so the system prompt and provenance ride along
                // in inputContext rather than columns of their own.
                await db.insert(fineTuningExamples).values({
                    datasetId: targetDataset.id,
                    input: typeof inputContent === "object" ? JSON.stringify(inputContent) : String(inputContent),
                    output: typeof outputContent === "object" ? JSON.stringify(outputContent) : String(outputContent),
                    inputContext: {
                        systemPrompt,
                        source: "huggingface",
                        datasetName,
                        rawRow: r,
                    }
                });
                insertedCount++;
            }
        }

        // A dataset whose columns this script does not recognise downloads
        // perfectly and stores nothing, and the old message still said
        // "Ingestion Complete" over a zero. That leaves a dataset record with no
        // examples and a success line in the log — the failure mode is invisible
        // exactly when you most need to see it.
        if (insertedCount === 0) {
            logger.error(
                `Downloaded ${rows.length} rows from "${datasetName}" but mapped NONE of them to ` +
                    `input/output pairs. Its columns are not a shape this script understands: ` +
                    `[${rows[0] ? Object.keys(rows[0].row).join(", ") : "no rows"}]. ` +
                    `Add a mapping for them rather than treating this as a successful import.`,
            );
            process.exit(1);
        }
        if (insertedCount < rows.length) {
            logger.warn(
                `Stored ${insertedCount} of ${rows.length} rows — ${rows.length - insertedCount} ` +
                    `had no usable input/output pair and were skipped.`,
            );
        }

        logger.info(`\n🎉 Ingestion Complete! Successfully stored ${insertedCount} fine-tuning examples for "${datasetName}".`);
        logger.info(`💡 You can view this dataset in the UI under /knowledge/datasets or use StudentTrainingService to fine-tune local models.`);
        process.exit(0);

    } catch (error: any) {
        logger.error(`❌ Failed to import Hugging Face dataset: ${error.message}`);
        process.exit(1);
    }
}

const args = process.argv.slice(2);
const datasetName = args[0] || "glaiveai/glaive-function-calling-v2";
const split = args[1] || "train";
const limit = parseInt(args[2] || "50", 10);
// orgId was a function default of 1 that the CLI never passed, so every import
// landed in organization 1 whether or not it existed — silently orphaning the
// rows from the org that asked for them. Now explicit, and validated below.
const orgId = parseInt(args[3] || "1", 10);

async function main() {
    const { orgs } = await import("../shared/schema/index.js");
    const [org] = await db.select({ id: orgs.id, name: orgs.name })
        .from(orgs)
        .where(eq(orgs.id, orgId))
        .limit(1);
    if (!org) {
        logger.error(
            `No organization ${orgId}. Pass one explicitly: ` +
                `npx tsx scripts/import-hf-dataset.ts <dataset> <split> <limit> <orgId>`,
        );
        process.exit(1);
    }
    logger.info(`Importing into organization ${org.id} ("${org.name}").`);
    await importHuggingFaceDataset(datasetName, split, limit, orgId);
}

void main();
