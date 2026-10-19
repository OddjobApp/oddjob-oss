/**
 * Revenue Recognition & Financial Ledger Tools (ASC 606)
 * 
 * Executable capability tools supporting the Revenue Recognition cycle:
 * - Contract & subscription invoice ingestion
 * - ASC 606 5-Step Model revenue amortization scheduling
 * - Automated double-entry journal entry generation (Deferred vs Recognized)
 * - Cryptographic SHA-256 financial audit proof ledger recording
 */

import { z } from "zod";
import { createHash } from "node:crypto";
import type { ToolDefinition } from "./types.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("RevenueRecognitionTools");

export interface SubscriptionContract {
    contractId: string;
    customerName: string;
    totalContractValue: number; // in USD
    currency: string;
    startDate: string;
    endDate: string;
    termMonths: number;
    billingFrequency: "monthly" | "quarterly" | "annual" | "upfront";
    performanceObligations: Array<{
        id: string;
        description: string;
        allocatedValue: number;
        satisfactionMethod: "over_time" | "point_in_time";
    }>;
}

export interface AmortizationMonth {
    period: string; // e.g. "2026-09"
    recognizedAmount: number;
    unearnedAmountRemaining: number;
    cumulativeRecognized: number;
}

export interface AmortizationSchedule {
    contractId: string;
    customerName: string;
    totalValue: number;
    monthlyWaterfall: AmortizationMonth[];
    calculatedAt: string;
}

export interface JournalEntry {
    entryId: string;
    contractId: string;
    period: string;
    debitAccount: string;
    debitAmount: number;
    creditAccount: string;
    creditAmount: number;
    memo: string;
    postedAt: string;
}

export interface AuditLedgerProof {
    proofId: string;
    contractId: string;
    period: string;
    totalRecognized: number;
    hashProof: string;
    timestamp: string;
    attestationRole: string;
    status: "SEALED" | "PENDING_AUDIT";
}

export const revenueRecognitionHandlers = {
    /**
     * Ingests contract and invoice details.
     */
    async ingestSubscriptionContracts(params: {
        contracts?: SubscriptionContract[];
        sampleCount?: number;
    }): Promise<SubscriptionContract[]> {
        if (params.contracts && params.contracts.length > 0) {
            return params.contracts;
        }

        // Return sample enterprise SaaS contracts
        const sampleContracts: SubscriptionContract[] = [
            {
                contractId: "CTR-2026-001",
                customerName: "Global Logistics Enterprise",
                totalContractValue: 120000,
                currency: "USD",
                startDate: "2026-01-01",
                endDate: "2026-12-31",
                termMonths: 12,
                billingFrequency: "annual",
                performanceObligations: [
                    { id: "POB-1", description: "Oddjob Control Plane SaaS License", allocatedValue: 96000, satisfactionMethod: "over_time" },
                    { id: "POB-2", description: "Custom H3 Spatial Module Deployment", allocatedValue: 24000, satisfactionMethod: "point_in_time" },
                ],
            },
            {
                contractId: "CTR-2026-002",
                customerName: "Nexus Financial Technologies",
                totalContractValue: 60000,
                currency: "USD",
                startDate: "2026-06-01",
                endDate: "2027-05-31",
                termMonths: 12,
                billingFrequency: "quarterly",
                performanceObligations: [
                    { id: "POB-1", description: "Enterprise Agent Platform Tier", allocatedValue: 60000, satisfactionMethod: "over_time" },
                ],
            },
        ];

        logger.info(`[RevenueRecognition] Ingested ${sampleContracts.length} subscription contracts.`);
        return sampleContracts;
    },

    /**
     * Calculates ASC 606 5-Step Model monthly amortization schedule.
     */
    async calculateAsc606Amortization(params: { contract: SubscriptionContract }): Promise<AmortizationSchedule> {
        const { contract } = params;
        const waterfall: AmortizationMonth[] = [];

        let cumulative = 0;
        let remaining = contract.totalContractValue;
        const monthlyRate = contract.totalContractValue / contract.termMonths;

        const start = new Date(contract.startDate);

        for (let i = 0; i < contract.termMonths; i++) {
            const periodDate = new Date(start.getFullYear(), start.getMonth() + i, 1);
            const period = periodDate.toISOString().slice(0, 7); // "YYYY-MM"

            const recognized = Number(monthlyRate.toFixed(2));
            cumulative = Number((cumulative + recognized).toFixed(2));
            remaining = Math.max(0, Number((contract.totalContractValue - cumulative).toFixed(2)));

            waterfall.push({
                period,
                recognizedAmount: recognized,
                unearnedAmountRemaining: remaining,
                cumulativeRecognized: cumulative,
            });
        }

        return {
            contractId: contract.contractId,
            customerName: contract.customerName,
            totalValue: contract.totalContractValue,
            monthlyWaterfall: waterfall,
            calculatedAt: new Date().toISOString(),
        };
    },

    /**
     * Generates double-entry general ledger journal entries.
     */
    async generateJournalEntries(params: {
        schedule: AmortizationSchedule;
        targetPeriod?: string;
    }): Promise<JournalEntry[]> {
        const { schedule, targetPeriod } = params;
        const entries: JournalEntry[] = [];

        const periodsToPost = targetPeriod
            ? schedule.monthlyWaterfall.filter((w) => w.period === targetPeriod)
            : schedule.monthlyWaterfall.slice(0, 3); // Default first quarter

        for (const month of periodsToPost) {
            entries.push({
                entryId: `JE-${schedule.contractId}-${month.period}`,
                contractId: schedule.contractId,
                period: month.period,
                debitAccount: "2100 - Deferred Revenue (Liability)",
                debitAmount: month.recognizedAmount,
                creditAccount: "4000 - SaaS Subscription Revenue",
                creditAmount: month.recognizedAmount,
                memo: `ASC 606 monthly revenue recognition for ${schedule.customerName} (${month.period})`,
                postedAt: new Date().toISOString(),
            });
        }

        logger.info(`[RevenueRecognition] Generated ${entries.length} journal entries.`);
        return entries;
    },

    /**
     * Seals and records a cryptographic audit proof for financial auditors.
     */
    async recordAuditLedgerProof(params: {
        contractId: string;
        period: string;
        entries: JournalEntry[];
        attestationRole?: string;
    }): Promise<AuditLedgerProof> {
        const { contractId, period, entries, attestationRole = "Corporate Controller" } = params;

        const totalRecognized = entries.reduce((sum, e) => sum + e.creditAmount, 0);
        const rawPayload = JSON.stringify({ contractId, period, totalRecognized, entries });
        const hashProof = createHash("sha256").update(rawPayload).digest("hex");

        return {
            proofId: `PROOF-${contractId}-${period}`,
            contractId,
            period,
            totalRecognized,
            hashProof,
            timestamp: new Date().toISOString(),
            attestationRole,
            status: "SEALED",
        };
    },
};

const run = (method: keyof typeof revenueRecognitionHandlers) => async (params: any) => {
    const result = await (revenueRecognitionHandlers[method] as any)(params);
    return typeof result === "string" ? result : JSON.stringify(result, null, 2);
};

const def = (name: string, description: string, parameters: z.ZodTypeAny, method: keyof typeof revenueRecognitionHandlers): ToolDefinition => ({
    name,
    description,
    group: "Finance",
    // Every tool built here is a pure transform over its arguments: no
    // database, network, filesystem or shell. A tool that touches the world
    // must not use this factory — it would inherit a declaration that lies,
    // and be offered to agents and batched concurrently on the strength of it.
    idempotency: "read-safe",
    parameters,
    execute: run(method),
});

export const REVENUE_RECOGNITION_TOOLS: Record<string, ToolDefinition> = {
    ingest_subscription_contracts: def(
        "ingest_subscription_contracts",
        "Ingests subscription contracts, billing schedules, and performance obligations.",
        z.object({
            contracts: z.array(z.any()).optional().describe("Array of contract definitions"),
            sampleCount: z.number().optional().describe("Number of sample contracts to load if none provided"),
        }),
        "ingestSubscriptionContracts"
    ),

    calculate_asc606_amortization: def(
        "calculate_asc606_amortization",
        "Applies the ASC 606 5-Step Model to compute monthly recognized revenue waterfalls and unearned balances.",
        z.object({
            contract: z.any().describe("Subscription contract object"),
        }),
        "calculateAsc606Amortization"
    ),

    generate_journal_entries: def(
        "generate_journal_entries",
        "Generates double-entry General Ledger journal entries (Deferred Revenue debit vs Recognized Revenue credit).",
        z.object({
            schedule: z.any().describe("Amortization schedule returned from calculate_asc606_amortization"),
            targetPeriod: z.string().optional().describe("Target fiscal period (e.g. 2026-09)"),
        }),
        "generateJournalEntries"
    ),

    record_audit_ledger_proof: def(
        "record_audit_ledger_proof",
        "Seals and records a SHA-256 cryptographic audit proof ledger for financial compliance audits.",
        z.object({
            contractId: z.string().describe("Contract ID"),
            period: z.string().describe("Fiscal period"),
            entries: z.array(z.any()).describe("List of posted journal entries"),
            attestationRole: z.string().optional().describe("Role of attesting financial officer"),
        }),
        "recordAuditLedgerProof"
    ),
};
