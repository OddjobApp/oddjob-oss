/**
 * Adversarial Consensus & Cryptographic Attestation Tools
 * 
 * Exposes multi-agent deliberation and HMAC attestation token operations
 * to AI agents, Copilot, and governance orchestration.
 */

import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import {
    adversarialConsensusService,
    type AttestationToken,
} from "@domain/governance/core/adversarial-consensus.service.js";

export const CONSENSUS_TOOLS: Record<string, ToolDefinition> = {
    request_adversarial_consensus: {
        name: "request_adversarial_consensus",
        idempotency: "none",
        label: "Request Adversarial Consensus",
        group: "Governance",
        description: "Executes tripartite adversarial deliberation (Lead Architect, Compliance Sentinel, Devil's Advocate) before high-blast operations and mints a cryptographic AttestationToken if approved.",
        parameters: z.object({
            action: z.string().describe("The action being requested (e.g. deploy_production, mutate_production_db, export_pii)"),
            payload: z.record(z.any()).describe("Action payload and configuration to be inspected"),
            targetResource: z.string().optional().describe("The target infrastructure, resource URI, or table"),
            mintToken: z.boolean().optional().default(true).describe("Whether to mint a cryptographic AttestationToken upon approval"),
        }),
        execute: async (params: any, context?: any) => {
            try {
                const deliberation = await adversarialConsensusService.deliberate(
                    params.action,
                    params.payload,
                    {
                        organizationId: context?.organizationId,
                        sessionId: context?.sessionId,
                        evidence: context?.evidence,
                    }
                );

                let attestationToken: AttestationToken | null = null;
                if (deliberation.decision === "approved" && params.mintToken !== false) {
                    attestationToken = adversarialConsensusService.generateAttestationToken(
                        params.action,
                        params.payload,
                        deliberation,
                        undefined,
                        params.targetResource
                    );
                }

                return JSON.stringify({
                    success: true,
                    action: params.action,
                    decision: deliberation.decision,
                    consensusScore: deliberation.consensusScore,
                    hasVeto: deliberation.hasVeto,
                    vetoReasons: deliberation.vetoReasons,
                    requiredMitigations: deliberation.mitigations,
                    votes: deliberation.votes,
                    attestationToken,
                });
            } catch (err: any) {
                return `Error executing adversarial deliberation: ${err.message}`;
            }
        },
    },

    verify_action_attestation: {
        name: "verify_action_attestation",
        idempotency: "read-safe",
        label: "Verify Action Attestation",
        group: "Governance",
        description: "Verifies the cryptographic HMAC-SHA256 signature, expiry, and payload integrity of an AttestationToken.",
        parameters: z.object({
            token: z.any().describe("The AttestationToken object or JSON string to verify"),
            expectedAction: z.string().optional().describe("Expected action type to match against token"),
            expectedPayload: z.record(z.any()).optional().describe("Expected payload to verify cryptographic hash match"),
        }),
        execute: async (params: any) => {
            try {
                let tokenObj = params.token;
                if (typeof tokenObj === "string") {
                    tokenObj = JSON.parse(tokenObj);
                }

                const result = adversarialConsensusService.verifyAttestationToken(
                    tokenObj,
                    params.expectedAction,
                    params.expectedPayload
                );

                return JSON.stringify({
                    valid: result.valid,
                    reason: result.reason,
                    tokenAction: tokenObj?.action,
                    expiresAt: tokenObj?.expiresAt,
                    consensusScore: tokenObj?.consensusScore,
                });
            } catch (err: any) {
                return `Error verifying attestation token: ${err.message}`;
            }
        },
    },
};
