/**
 * statement_ingest executor (BudgetMaster / SAWM, PRD §3, §5.1).
 *
 * Consumes statement files (OFX/QIF/CSV) produced by an upstream folder_import
 * step (read_content mode) and writes normalized `transactions` rows into the
 * app_records dataset collection. The transaction recordId IS the fitid, so the
 * app_records unique index gives free dedupe. Context is routed from the source
 * sub-folder unless an explicit contextId is configured.
 *
 * No real bank rails are touched — this is pure ingestion of statement files.
 */

import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { AppRecordsStore } from "../../../finance/core/app-records-store.js";
import { parseStatement } from "../../../finance/core/statement-parser.service.js";
import { ingestParsedTransactions } from "../../../finance/core/transaction.service.js";
import { routeContextForPath } from "../../../finance/core/collections.js";

interface StatementFile {
    fileName: string;
    content: string;
}

/** Collect statement files from config or upstream step output, tolerantly. */
function collectFiles(config: any, context: any): StatementFile[] {
    const out: StatementFile[] = [];
    const push = (fileName?: string, content?: unknown) => {
        if (typeof content === "string" && content.length > 0) {
            out.push({ fileName: fileName || "statement.csv", content });
        }
    };

    // Shape A: explicit single file on the config.
    if (config?.content) push(config.fileName, config.content);

    // Shape B: array of {filename/fileName/name, content} (folder_import read_content).
    const candidates = [config?.files, context?.named?.files, context?.data?.files].filter(Array.isArray);
    for (const arr of candidates) {
        for (const f of arr as any[]) {
            const name = f.fileName ?? f.filename ?? f.name;
            // folder_import may have JSON-parsed CSVs already; re-stringify rows.
            const content = typeof f.content === "string" ? f.content : undefined;
            push(name, content);
        }
    }
    return out;
}

export class StatementIngestExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "statement_ingest";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        _pipeline: Pipeline,
        context: VariableContext,
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "statement_ingest requires an organizationId" };
        }

        const config = resolvedConfig ?? {};
        const accountId: string = config.accountId ?? "acc_unassigned";
        const files = collectFiles(config, context as any);

        if (files.length === 0) {
            return {
                success: true,
                output: JSON.stringify({ inserted: 0, skipped: 0, files: 0, note: "no statement files to ingest" }),
                status: "success",
            };
        }

        const store = await AppRecordsStore.forOrg(orgId);
        let inserted = 0;
        let skipped = 0;
        const perFile: Array<{ fileName: string; inserted: number; skipped: number }> = [];

        for (const file of files) {
            const contextId: string = config.contextId ?? routeContextForPath(file.fileName);
            const parsed = await parseStatement(file.fileName, file.content);
            const res = await ingestParsedTransactions(store, { accountId, contextId, parsed });
            inserted += res.inserted;
            skipped += res.skipped;
            perFile.push({ fileName: file.fileName, inserted: res.inserted, skipped: res.skipped });
        }

        return {
            success: true,
            output: JSON.stringify({ inserted, skipped, files: files.length, perFile }),
            status: "success",
            telemetry: { transactions_inserted: inserted, transactions_skipped: skipped },
        };
    }
}
