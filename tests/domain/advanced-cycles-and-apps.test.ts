/**
 * Advanced Blueprint Cycles & Capability Tools Tests
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

import { competitiveIntelHandlers, COMPETITIVE_INTEL_TOOLS } from "@domain/tools/v1/capabilities/competitive-intel-tools.js";
import { revenueRecognitionHandlers, REVENUE_RECOGNITION_TOOLS } from "@domain/tools/v1/capabilities/revenue-recognition-tools.js";
import { chaosDrillHandlers, CHAOS_DRILL_TOOLS } from "@domain/tools/v1/capabilities/chaos-drill-tools.js";

describe("Competitive Intelligence Blueprint Cycle & Tools", () => {
    it("loads and parses competitive-intelligence-strategy.cycle.yaml", () => {
        const yamlPath = path.resolve(process.cwd(), "server/cycles/competitive-intelligence-strategy.cycle.yaml");
        const fileContent = readFileSync(yamlPath, "utf-8");
        const parsed: any = yaml.load(fileContent);

        expect(parsed).toBeDefined();
        expect(parsed.name).toContain("Competitive Intelligence");
        expect(parsed.phases).toHaveLength(3);

        const phaseIds = parsed.phases.map((p: any) => p.id);
        expect(phaseIds).toContain("phase_1_signal_ingestion_and_causal_mapping");
        expect(phaseIds).toContain("phase_2_hil_strategy_approval");
        expect(phaseIds).toContain("phase_3_roadmap_backlog_sync");
    });

    it("ingests market signals and maps causal blast radius", async () => {
        const signals = await competitiveIntelHandlers.ingestMarketSignals({ limit: 2 });
        expect(signals.length).toBe(2);

        const firstSignal = signals[0];
        expect(firstSignal.competitorName).toBeDefined();
        expect(firstSignal.extractedFeatures.length).toBeGreaterThan(0);

        const blastRadius = await competitiveIntelHandlers.mapCausalBlastRadius({ signal: firstSignal });
        expect(blastRadius.overlapScore).toBeGreaterThan(0);
        expect(blastRadius.affectedInternalModules.length).toBeGreaterThan(0);
        expect(blastRadius.threatLevel).toBeDefined();

        const epics = await competitiveIntelHandlers.generateCounterStrategyEpics({
            blastRadius,
            targetSprint: "Sprint 1 (Immediate)",
            managerGuidance: "Prioritize developer tools and AST speed",
        });

        expect(epics.title).toContain("Counter-Strategy");
        expect(epics.userStories.length).toBeGreaterThan(0);
        expect(epics.userStories[0].acceptanceCriteria.length).toBeGreaterThan(0);
    });

    it("verifies COMPETITIVE_INTEL_TOOLS schema definitions", () => {
        expect(COMPETITIVE_INTEL_TOOLS.ingest_market_signals).toBeDefined();
        expect(COMPETITIVE_INTEL_TOOLS.map_causal_blast_radius).toBeDefined();
        expect(COMPETITIVE_INTEL_TOOLS.generate_counter_strategy_epics).toBeDefined();
    });
});

describe("Revenue Recognition (ASC 606) Blueprint Cycle & Tools", () => {
    it("loads and parses revenue-recognition.cycle.yaml", () => {
        const yamlPath = path.resolve(process.cwd(), "server/cycles/revenue-recognition.cycle.yaml");
        const fileContent = readFileSync(yamlPath, "utf-8");
        const parsed: any = yaml.load(fileContent);

        expect(parsed).toBeDefined();
        expect(parsed.name).toContain("Revenue Recognition");
        expect(parsed.phases).toHaveLength(4);

        const phaseIds = parsed.phases.map((p: any) => p.id);
        expect(phaseIds).toContain("phase_1_contract_ingestion_and_amortization");
        expect(phaseIds).toContain("phase_2_journal_entry_generation");
        expect(phaseIds).toContain("phase_3_hil_controller_signoff");
        expect(phaseIds).toContain("phase_4_audit_ledger_sealing");
    });

    it("calculates ASC 606 amortization waterfalls and double-entry journal entries", async () => {
        const contracts = await revenueRecognitionHandlers.ingestSubscriptionContracts({});
        expect(contracts.length).toBeGreaterThanOrEqual(1);

        const contract = contracts[0];
        const schedule = await revenueRecognitionHandlers.calculateAsc606Amortization({ contract });

        expect(schedule.monthlyWaterfall).toHaveLength(contract.termMonths);
        expect(schedule.totalValue).toBe(contract.totalContractValue);

        // Verify mathematical consistency: cumulative recognized ends at totalContractValue
        const finalMonth = schedule.monthlyWaterfall[schedule.monthlyWaterfall.length - 1];
        expect(finalMonth.cumulativeRecognized).toBeCloseTo(contract.totalContractValue, 1);
        expect(finalMonth.unearnedAmountRemaining).toBe(0);

        const journalEntries = await revenueRecognitionHandlers.generateJournalEntries({
            schedule,
            targetPeriod: schedule.monthlyWaterfall[0].period,
        });

        expect(journalEntries.length).toBe(1);
        expect(journalEntries[0].debitAmount).toBe(journalEntries[0].creditAmount);
        expect(journalEntries[0].debitAccount).toContain("Deferred Revenue");
        expect(journalEntries[0].creditAccount).toContain("Subscription Revenue");

        const proof = await revenueRecognitionHandlers.recordAuditLedgerProof({
            contractId: contract.contractId,
            period: schedule.monthlyWaterfall[0].period,
            entries: journalEntries,
            attestationRole: "VP of Finance",
        });

        expect(proof.hashProof).toHaveLength(64); // SHA-256 hex string
        expect(proof.status).toBe("SEALED");
    });

    it("verifies REVENUE_RECOGNITION_TOOLS schema definitions", () => {
        expect(REVENUE_RECOGNITION_TOOLS.ingest_subscription_contracts).toBeDefined();
        expect(REVENUE_RECOGNITION_TOOLS.calculate_asc606_amortization).toBeDefined();
        expect(REVENUE_RECOGNITION_TOOLS.generate_journal_entries).toBeDefined();
        expect(REVENUE_RECOGNITION_TOOLS.record_audit_ledger_proof).toBeDefined();
    });
});

describe("Chaos Engineering & SRE Resilience Blueprint Cycle & Tools", () => {
    it("loads and parses chaos-drill.cycle.yaml", () => {
        const yamlPath = path.resolve(process.cwd(), "server/cycles/chaos-drill.cycle.yaml");
        const fileContent = readFileSync(yamlPath, "utf-8");
        const parsed: any = yaml.load(fileContent);

        expect(parsed).toBeDefined();
        expect(parsed.name).toContain("Chaos");
        expect(parsed.phases).toHaveLength(4);

        const phaseIds = parsed.phases.map((p: any) => p.id);
        expect(phaseIds).toContain("phase_1_safety_preflight");
        expect(phaseIds).toContain("phase_2_hil_drill_authorization");
        expect(phaseIds).toContain("phase_3_controlled_fault_injection");
        expect(phaseIds).toContain("phase_4_post_mortem_and_remediation");
    });

    it("executes error budget safety checks, latency injections, and post-mortem generation", async () => {
        const budgetStatus = await chaosDrillHandlers.checkErrorBudgetSafety({
            serviceName: "payment-gateway",
            minRequiredBudgetPercent: 25,
        });

        expect(budgetStatus.isSafeToDrill).toBe(true);
        expect(budgetStatus.remainingBudgetPercent).toBeGreaterThanOrEqual(25);

        const injectionResult = await chaosDrillHandlers.simulateNetworkLatency({
            targetService: "payment-gateway",
            addedLatencyMs: 1200,
            durationSeconds: 10,
        });

        expect(injectionResult.circuitBreakerTripped).toBe(true);
        expect(injectionResult.fallbackTriggered).toBe(true);
        expect(injectionResult.status).toBe("RECOVERED");

        const postMortem = await chaosDrillHandlers.generateChaosPostMortem({
            injectionResult,
            scenarioDescription: "Payment Gateway High Latency Injection",
        });

        expect(postMortem.resilienceScore).toBeGreaterThanOrEqual(90);
        expect(postMortem.timeline.length).toBeGreaterThanOrEqual(3);
        expect(postMortem.actionItems.length).toBeGreaterThanOrEqual(1);
    });

    it("verifies CHAOS_DRILL_TOOLS schema definitions", () => {
        expect(CHAOS_DRILL_TOOLS.check_error_budget_safety).toBeDefined();
        expect(CHAOS_DRILL_TOOLS.simulate_network_latency).toBeDefined();
        expect(CHAOS_DRILL_TOOLS.simulate_service_failure).toBeDefined();
        expect(CHAOS_DRILL_TOOLS.generate_chaos_post_mortem).toBeDefined();
    });
});
