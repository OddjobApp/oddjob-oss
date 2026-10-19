import { describe, it, expect, beforeEach } from "vitest";
import { CoreRedactionService } from "../core/core-redaction.service.js";
import { CoreHydrationService } from "../core/core-hydration.service.js";
import { StreamingTokenBuffer } from "../core/streaming-token-buffer.js";
import { ephemeralVaultCache } from "../core/ephemeral-vault-cache.service.js";

describe("CORE Redaction & Hydration Engine", () => {
    const redactionService = new CoreRedactionService();
    const hydrationService = new CoreHydrationService();

    beforeEach(async () => {
        await ephemeralVaultCache.flushForDocument(42, 100);
    });

    describe("CoreRedactionService", () => {
        it("extracts :::sandbox blocks and injects surrogate beat markers", async () => {
            const rawDraft = `
# Chapter 1: The Gathering

The storm rattled against the library windows.

:::sandbox id="terrace_scene" type="adult" mode="static_reinsert" summary="Alice and Bob passionately embrace on the balcony."
Alice gripped the cold stone railing as Bob stepped out behind her.
Her whisper was lost in the thunder as he pulled her close.
:::

By morning, only the scent of ozone remained.
`.trim();

            const result = await redactionService.redactText(rawDraft, {
                organizationId: 42,
                documentId: 100,
            });

            expect(result.extractedCount).toBe(1);
            expect(result.tokens.length).toBe(1);
            expect(result.tokens[0].classification).toBe("adult");
            expect(result.tokens[0].summary).toBe("Alice and Bob passionately embrace on the balcony.");
            expect(result.tokens[0].rawPayload).toContain("Alice gripped the cold stone railing");

            // Verify raw payload NEVER appears in sanitized output
            expect(result.sanitizedText).not.toContain("Alice gripped the cold stone railing");
            expect(result.sanitizedText).not.toContain(":::sandbox");

            // Verify surrogate marker exists
            expect(result.sanitizedText).toContain("[SCENE_BEAT: Alice and Bob passionately embrace on the balcony.]");
            expect(result.sanitizedText).toMatch(/<<ODDJOB_MASK:[a-f0-9]{8}>>/);
        });

        it("handles multiple sandbox blocks with distinct token IDs", async () => {
            const multiBlock = `
:::sandbox id="scene_1" type="violence" summary="Violent alley fight."
Marcus slammed the assailant against the brick wall.
:::

Normal transition dialogue.

:::sandbox id="scene_2" type="pii" summary="Confidential informant identity."
The informant is agent Sarah Connor, SSN 000-11-2222.
:::
`.trim();

            const result = await redactionService.redactText(multiBlock, {
                organizationId: 42,
                documentId: 100,
            });

            expect(result.extractedCount).toBe(2);
            expect(result.tokens[0].classification).toBe("violence");
            expect(result.tokens[1].classification).toBe("pii");
            expect(result.tokens[0].tokenId).not.toBe(result.tokens[1].tokenId);
        });
    });

    describe("CoreHydrationService", () => {
        it("rehydrates exact tokens and removes model-hallucinated beat echoes", async () => {
            const rawProse = "Marcus swung his blade in a silent arc, ending the standoff.";
            const tokenId = "ODDJOB_MASK:9a8b7c6d";

            await ephemeralVaultCache.set({
                tokenId,
                organizationId: 42,
                documentId: 100,
                classification: "violence",
                mode: "static_reinsert",
                summary: "Marcus executes a swift duel finisher.",
                rawPayload: rawProse,
                createdAt: Date.now(),
            });

            // Simulated cloud response where model echoed the beat label
            const cloudOutput = `The room fell silent. [SCENE_BEAT: Marcus executes a swift duel finisher.] <<${tokenId}>> The guards retreated in horror.`;

            const rehydrated = await hydrationService.rehydrateText(cloudOutput, {
                organizationId: 42,
                documentId: 100,
            });

            // Beat label must be stripped
            expect(rehydrated).not.toContain("[SCENE_BEAT:");
            // Raw text must be restored
            expect(rehydrated).toContain(rawProse);
            expect(rehydrated).toBe(
                `The room fell silent. ${rawProse} The guards retreated in horror.`
            );
        });

        it("handles token drift (whitespace, escaping, double brackets)", async () => {
            const rawProse = "Secret rendezvous in the catacombs.";
            const tokenId = "ODDJOB_MASK:drift001";

            await ephemeralVaultCache.set({
                tokenId,
                organizationId: 42,
                documentId: 100,
                classification: "confidential",
                mode: "static_reinsert",
                summary: "Catacombs meeting",
                rawPayload: rawProse,
                createdAt: Date.now(),
            });

            // Models often produce escaped characters or bracket styles:
            const driftedOutputs = [
                `They arrived. \\<\\<${tokenId}\\>\\> Dawn arrived.`,
                `They arrived. [[ ${tokenId} ]] Dawn arrived.`,
                `They arrived. << ${tokenId} >> Dawn arrived.`,
            ];

            for (const drifted of driftedOutputs) {
                const rehydrated = await hydrationService.rehydrateText(drifted, {
                    organizationId: 42,
                    documentId: 100,
                });
                expect(rehydrated).toContain(rawProse);
            }
        });
    });

    describe("StreamingTokenBuffer", () => {
        it("holds back fragmented tokens across streaming chunks and emits complete text", async () => {
            const buffer = new StreamingTokenBuffer();

            // Chunk 1 has a partial start of a token: "<<ODD"
            const out1 = await buffer.feed("The shadows lengthened. <<ODD");
            expect(out1).toBe("The shadows lengthened. ");
            expect(buffer.pendingBytes).toBe(5); // "<<ODD" held back

            // Chunk 2 completes the token and adds following prose
            const out2 = await buffer.feed("JOB_MASK:8f2a1c9e>> and night fell.");
            expect(out2).toBe("<<ODDJOB_MASK:8f2a1c9e>> and night fell.");
            expect(buffer.pendingBytes).toBe(0);

            // Final flush
            const out3 = await buffer.flush();
            expect(out3).toBe("");
        });

        it("releases regular angle brackets if buffer exceeds maxHoldBytes", async () => {
            const buffer = new StreamingTokenBuffer(16);

            // A normal mathematical inequality or unclosed tag:
            const out1 = await buffer.feed("If x < ");
            expect(out1).toBe("If x ");

            // Exceed the 16-byte hold window
            const out2 = await buffer.feed("y and z > w then result is valid and long.");
            expect(out1 + out2).toContain("If x < ");
        });

    });

    describe("End-to-End Zero Egress Round Trip", () => {
        it("redacts sensitive content, runs mock cloud continuity, and rehydrates losslessly", async () => {
            const originalDraft = `
The detective opened the confidential file.
:::sandbox id="evidence_photo" type="forensic" summary="Graphic autopsy photograph of victim."
The body showed severe trauma to the left temporal region consistent with blunt force impact.
:::
The detective frowned and dialed the precinct.
`.trim();

            // 1. Redaction phase (zero egress)
            const { sanitizedText, tokens } = await redactionService.redactText(originalDraft, {
                organizationId: 42,
                documentId: 100,
            });

            expect(sanitizedText).not.toContain("severe trauma");
            expect(tokens.length).toBe(1);

            // 2. Simulated Cloud Model Turn (maintains marker)
            const mockCloudResponse = sanitizedText.replace(
                "The detective frowned and dialed the precinct.",
                "The detective sighed heavily, knowing this case was about to become public."
            );

            // 3. Hydration phase
            const restoredDocument = await hydrationService.rehydrateText(mockCloudResponse, {
                organizationId: 42,
                documentId: 100,
            });

            expect(restoredDocument).toContain("The body showed severe trauma to the left temporal region");
            expect(restoredDocument).toContain("The detective sighed heavily");
            expect(restoredDocument).not.toContain("<<ODDJOB_MASK:");
        });
    });
});
