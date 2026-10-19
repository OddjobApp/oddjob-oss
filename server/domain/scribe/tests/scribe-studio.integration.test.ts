import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { scribeService } from "../core/scribe.service.js";
import { SCRIBE_TOOLS } from "../../tools/v1/capabilities/scribe.js";
import { db } from "@server/database_service.js";
import { crewSessions, scribeDocuments } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

describe("Scribe Studio Architecture & Services", () => {
    let testSessionId: number;
    const testOrgId = 1;

    beforeAll(async () => {
        const sessionKey = `test-scribe-session-${Date.now()}`;
        const [session] = await db
            .insert(crewSessions)
            .values({
                organizationId: testOrgId,
                sessionKey,
                title: "Test Scribe Creative Room",
                status: "active",
                mode: "explore",
                createdBy: "test_runner",
            })
            .returning();

        testSessionId = session.id;
    });

    afterAll(async () => {
        if (testSessionId) {
            await db.delete(crewSessions).where(eq(crewSessions.id, testSessionId));
        }
    });

    it("initializes a Hero's Journey document with 12 subway stations", async () => {
        const docView = await scribeService.createOrGetDocument(
            testSessionId,
            testOrgId,
            "Chronicles of the Red Nebula",
            "heros_journey",
            45000
        );

        expect(docView.document.id).toBeDefined();
        expect(docView.document.title).toBe("Chronicles of the Red Nebula");
        expect(docView.document.archetypeMode).toBe("heros_journey");
        expect(docView.document.targetWordCount).toBe(45000);
        expect(docView.nodes.length).toBe(12);

        // Check first and last stations
        expect(docView.nodes[0].stationKey).toBe("ordinary_world");
        expect(docView.nodes[0].sortOrder).toBe(1);
        expect(docView.nodes[11].stationKey).toBe("return_with_elixir");
        expect(docView.nodes[11].sortOrder).toBe(12);

        // Check telemetry
        expect(docView.telemetry.totalStations).toBe(12);
        expect(docView.telemetry.targetWordCount).toBe(45000);
    });

    it("updates station content and recalculates word count and EKG telemetry", async () => {
        const docView = await scribeService.getDocument((await scribeService.createOrGetDocument(testSessionId, testOrgId, "Chronicles of the Red Nebula")).document.id, testOrgId);
        const firstNode = docView.nodes[0];

        const sampleText = "Mara looked across the silent desert expanse of Kepler-452b. The atmospheric scrubbers hummed softly in the morning mist.";
        const updated = await scribeService.updateNodeContent(firstNode.id, testOrgId, sampleText, undefined, "approved");

        expect(updated.id).toBe(firstNode.id);
        expect(updated.content).toBe(sampleText);
        expect(updated.wordCount).toBe(18);
        expect(updated.status).toBe("approved");

        const reloaded = await scribeService.getDocument(docView.document.id, testOrgId);
        expect(reloaded.telemetry.totalWordCount).toBe(18);
        expect(reloaded.telemetry.stationsComplete).toBeGreaterThanOrEqual(1);
    });

    it("forks a new subway track branch and clones all stations", async () => {
        const docView = await scribeService.getDocument((await scribeService.createOrGetDocument(testSessionId, testOrgId, "Chronicles of the Red Nebula")).document.id, testOrgId);
        const result = await scribeService.forkBranch(
            docView.document.id,
            testOrgId,
            "ordinary_world",
            "Branch B: Action Incursion",
            "What if Mara is attacked in the opening scene?"
        );

        expect(result.branch.id).toBeDefined();
        expect(result.branch.name).toBe("Branch B: Action Incursion");
        expect(result.branch.divergedAtStationKey).toBe("ordinary_world");

        // Reload document in new branch
        const branchView = await scribeService.getDocument(docView.document.id, testOrgId, result.branch.id);
        expect(branchView.activeBranch.id).toBe(result.branch.id);
        expect(branchView.nodes.length).toBe(12);
        expect(branchView.allBranches.length).toBeGreaterThanOrEqual(2);
    });

    it("merges branch back into the main trunk", async () => {
        const docView = await scribeService.getDocument((await scribeService.createOrGetDocument(testSessionId, testOrgId, "Chronicles of the Red Nebula")).document.id, testOrgId);
        const mainBranch = docView.allBranches.find((b) => b.branchKey === "main")!;
        const forked = await scribeService.forkBranch(docView.document.id, testOrgId, "call_to_adventure", "Branch C: Fast Path");

        // Update a station in the forked branch
        const branchView = await scribeService.getDocument(docView.document.id, testOrgId, forked.branch.id);
        const targetNode = branchView.nodes[1]; // Station 2
        await scribeService.updateNodeContent(targetNode.id, testOrgId, "A distress beacon sounded from the abandoned station.", undefined, "approved");

        // Merge back into main
        const mergedDoc = await scribeService.mergeBranch(
            docView.document.id,
            testOrgId,
            forked.branch.id,
            mainBranch.id
        );

        expect(mergedDoc.activeBranch.id).toBe(mainBranch.id);
        const mergedStation2 = mergedDoc.nodes.find((n) => n.stationKey === targetNode.stationKey);
        expect(mergedStation2?.content).toContain("distress beacon");
    });

    it("compiles manuscript into structured Markdown", async () => {
        const docView = await scribeService.getDocument((await scribeService.createOrGetDocument(testSessionId, testOrgId, "Chronicles of the Red Nebula")).document.id, testOrgId);
        const compiled = await scribeService.compileManuscript(docView.document.id, testOrgId);

        expect(compiled.title).toBe(docView.document.title);
        expect(compiled.content).toContain("# Chronicles of the Red Nebula");
        expect(compiled.content).toContain("## 1. The Ordinary World");
        expect(compiled.wordCount).toBeGreaterThan(0);
    });

    it("refuses to read, write, or export another organization's document", async () => {
        const doc = await scribeService.createOrGetDocument(testSessionId, testOrgId, "Chronicles of the Red Nebula");
        const documentId = doc.document.id;
        const nodeId = doc.nodes[0].id;
        const foreignOrgId = testOrgId + 9999;

        // Ids are serial and guessable, so the org id is the whole boundary.
        await expect(scribeService.getDocument(documentId, foreignOrgId)).rejects.toThrow(/not found/i);
        await expect(scribeService.compileManuscript(documentId, foreignOrgId)).rejects.toThrow(/not found/i);
        await expect(
            scribeService.updateNodeContent(nodeId, foreignOrgId, "overwritten by another tenant"),
        ).rejects.toThrow(/not found/i);
        await expect(
            scribeService.forkBranch(documentId, foreignOrgId, "ordinary_world", "Hostile fork"),
        ).rejects.toThrow(/not found/i);

        // The rejected write must not have landed.
        const reloaded = await scribeService.getDocument(documentId, testOrgId);
        expect(reloaded.nodes.find((n) => n.id === nodeId)?.content).not.toContain("overwritten by another tenant");
    });

    it("refuses a tool call that arrives with no organization in context", async () => {
        await expect(
            SCRIBE_TOOLS.mount_scribe_studio.execute(
                { title: "Orphaned", archetypeMode: "freeform" },
                { sessionId: testSessionId } as any,
            ),
        ).resolves.toMatch(/no organization in tool context/i);
    });

    it("mount_scribe_studio tool returns interactive artifact payload", async () => {
        const [session2] = await db
            .insert(crewSessions)
            .values({
                organizationId: testOrgId,
                sessionKey: `test-scribe-session-2-${Date.now()}`,
                title: "Legal Contract War Room",
                status: "active",
                mode: "explore",
                createdBy: "test_runner",
            })
            .returning();

        const resultJson = await SCRIBE_TOOLS.mount_scribe_studio.execute({
            title: "Autonomous Enterprise MSA",
            archetypeMode: "saas_msa",
            targetWordCount: 7500,
        }, { sessionId: session2.id, organizationId: testOrgId } as any);

        const result = JSON.parse(resultJson);
        expect(result.type).toBe("scribe_foundry_pod");
        expect(result.module).toBe("ScribeStudioPod");
        expect(result.title).toBe("Autonomous Enterprise MSA");
        expect(result.stations.length).toBe(10);
    });

    it("publishes manuscript into canonical project deliverable and registers file_blobs / crew_attachments", async () => {
        const docView = await scribeService.getDocument((await scribeService.createOrGetDocument(testSessionId, testOrgId, "Published Contract")).document.id, testOrgId);
        
        const result = await scribeService.publishDocument(docView.document.id, testOrgId, {
            versionTag: "v1.0.0-final",
            releaseNotes: "Fully signed and approved contract draft",
            userId: "legal_lead",
            theme: "corporate_legal",
        });

        expect(result.versionTag).toBe("v1.0.0-final");
        expect(result.compiled.title).toBe(docView.document.title);
        expect(result.attachment).toBeDefined();
        expect(result.attachment.id).toBeDefined();
        expect(result.downloadUrl).toContain(`/api/attachments/${result.attachment.id}/download`);

        // Check document revision & publication history
        const reloaded = await scribeService.getDocument(docView.document.id, testOrgId);
        expect(reloaded.document.currentRevision).toBeGreaterThanOrEqual(2);
        const publications = (reloaded.document.settings as any)?.publications || [];
        expect(publications.length).toBeGreaterThanOrEqual(1);
        expect(publications[0].versionTag).toBe("v1.0.0-final");
        expect(publications[0].releaseNotes).toBe("Fully signed and approved contract draft");
    });

    it("publishes with targeted branchId, theme options, and accumulates multi-version history", async () => {
        const docView = await scribeService.createOrGetDocument(testSessionId, testOrgId, "Multi Branch Publish Doc");
        const mainNode = docView.nodes[0];
        await scribeService.updateNodeContent(mainNode.id, testOrgId, "Trunk baseline: Version 1.0 Production.");

        // 1. Initial Publish on trunk
        const pub1 = await scribeService.publishDocument(docView.document.id, testOrgId, {
            versionTag: "v1.0.0-trunk",
            releaseNotes: "Initial baseline release",
            theme: "corporate_legal",
        });
        expect(pub1.versionTag).toBe("v1.0.0-trunk");
        expect(pub1.compiled.content).toContain("Trunk baseline: Version 1.0 Production.");

        // 2. Fork a branch with distinct content
        const firstStationKey = docView.nodes[0].stationKey;
        const forked = await scribeService.forkBranch(
            docView.document.id,
            testOrgId,
            firstStationKey,
            "Experimental release branch",
            "Alternative draft path"
        );
        const branchView = await scribeService.getDocument(docView.document.id, testOrgId, forked.branch.id);
        const branchNode = branchView.nodes[0];
        await scribeService.updateNodeContent(branchNode.id, testOrgId, "Branch preview: Version 2.0-beta features.");

        // 3. Publish specifically targeting the forked branch
        const pub2 = await scribeService.publishDocument(docView.document.id, testOrgId, {
            branchId: forked.branch.id,
            versionTag: "v2.0.0-beta",
            releaseNotes: "Preview build compiled directly from experimental branch",
            theme: "modern_tech",
        });

        expect(pub2.versionTag).toBe("v2.0.0-beta");
        // Verify compiled content reflects the targeted branch content
        expect(pub2.compiled.content).toContain("Branch preview: Version 2.0-beta features.");
        expect(pub2.compiled.content).not.toContain("Trunk baseline: Version 1.0 Production.");

        // 4. Verify publication history accumulates chronologically newest-first
        const reloaded = await scribeService.getDocument(docView.document.id, testOrgId);
        const publications = (reloaded.document.settings as any)?.publications || [];
        expect(publications.length).toBeGreaterThanOrEqual(2);
        expect(publications[0].versionTag).toBe("v2.0.0-beta");
        expect(publications[0].theme).toBe("modern_tech");
        expect(publications[1].versionTag).toBe("v1.0.0-trunk");
        expect(publications[1].theme).toBe("corporate_legal");

        // 5. Security check: cannot publish another org's document
        const wrongOrgId = 999999;
        await expect(
            scribeService.publishDocument(docView.document.id, wrongOrgId, {
                versionTag: "v-hacked",
            })
        ).rejects.toThrow();
    });

    it("surgically replaces a targeted excerpt within a station node", async () => {
        const docView = await scribeService.createOrGetDocument(testSessionId, testOrgId, "Surgical Excerpt Doc");
        const node = docView.nodes[0];

        // Initial content
        await scribeService.updateNodeContent(node.id, testOrgId, "Clause 1.0: All parties shall agree to 30-day payment terms unconditionally.");

        // Surgical replacement
        const updated = await scribeService.updateNodeContent(
            node.id,
            testOrgId,
            undefined,
            undefined,
            undefined,
            "30-day payment terms",
            "60-day payment terms with early discount"
        );

        expect(updated.content).toBe("Clause 1.0: All parties shall agree to 60-day payment terms with early discount unconditionally.");

        // Non-matching target excerpt throws informative error
        await expect(
            scribeService.updateNodeContent(
                node.id,
                testOrgId,
                undefined,
                undefined,
                undefined,
                "non-existent phrase",
                "replacement"
            )
        ).rejects.toThrow(/Target excerpt not found/i);
    });

    it("configures custom stations and outline cleanly via configureStations and scribe_configure_stations tool", async () => {
        const docView = await scribeService.createOrGetDocument(testSessionId, testOrgId, "Custom Outline Doc");
        const documentId = docView.document.id;

        const newStations = [
            { stationKey: "exec_summary", title: "Executive Summary", description: "High-level strategic briefing" },
            { stationKey: "market_analysis", title: "Market Analysis", description: "Competitive landscape and TAM" },
            { stationKey: "financial_model", title: "Financial Model", description: "Projections and cap table" },
        ];

        const reconfigured = await scribeService.configureStations(documentId, testOrgId, newStations);

        expect(reconfigured.nodes.length).toBe(3);
        expect(reconfigured.nodes.map(n => n.stationKey)).toEqual(["exec_summary", "market_analysis", "financial_model"]);
        expect(reconfigured.nodes.map(n => n.title)).toEqual(["Executive Summary", "Market Analysis", "Financial Model"]);
        expect(reconfigured.telemetry.totalStations).toBe(3);

        // Also test the scribe_configure_stations tool
        const toolResultJson = await SCRIBE_TOOLS.scribe_configure_stations.execute(
            {
                documentId,
                stations: [
                    { stationKey: "part_one", title: "Part 1: Inception" },
                    { stationKey: "part_two", title: "Part 2: Execution" },
                ],
            },
            { sessionId: testSessionId, organizationId: testOrgId } as any
        );

        const toolResult = JSON.parse(toolResultJson);
        expect(toolResult.success).toBe(true);
        expect(toolResult.stationsCount).toBe(2);

        const finalView = await scribeService.getDocument(documentId, testOrgId);
        expect(finalView.nodes.length).toBe(2);
        expect(finalView.nodes[0].stationKey).toBe("part_one");
        expect(finalView.nodes[1].stationKey).toBe("part_two");
    });

    it("renames and reorders stations while dynamically refreshing the Table of Contents", async () => {
        const docView = await scribeService.createOrGetDocument(testSessionId, testOrgId, "TOC Dynamic Doc");
        const documentId = docView.document.id;

        // Configure initial stations including a table_of_contents station
        await scribeService.configureStations(documentId, testOrgId, [
            { stationKey: "table_of_contents", title: "Table of Contents" },
            { stationKey: "intro", title: "Introduction" },
            { stationKey: "methodology", title: "Methodology" },
            { stationKey: "results", title: "Results" },
        ]);

        let currentView = await scribeService.getDocument(documentId, testOrgId);
        let tocNode = currentView.nodes.find(n => n.stationKey === "table_of_contents")!;
        expect(tocNode.content).toContain("1. [Introduction](#intro)");
        expect(tocNode.content).toContain("2. [Methodology](#methodology)");
        expect(tocNode.content).toContain("3. [Results](#results)");

        // 1. Rename a station -> TOC should update with new title
        const methodNode = currentView.nodes.find(n => n.stationKey === "methodology")!;
        await scribeService.renameStation(methodNode.id, testOrgId, "Research Methodology & Protocols");

        currentView = await scribeService.getDocument(documentId, testOrgId);
        tocNode = currentView.nodes.find(n => n.stationKey === "table_of_contents")!;
        expect(tocNode.content).toContain("2. [Research Methodology & Protocols](#methodology)");

        // 2. Reorder stations -> TOC should reflect new ordering
        const introNode = currentView.nodes.find(n => n.stationKey === "intro")!;
        const resultsNode = currentView.nodes.find(n => n.stationKey === "results")!;

        // New order: TOC, Results, Introduction, Methodology
        await scribeService.reorderStations(documentId, testOrgId, [
            tocNode.id,
            resultsNode.id,
            introNode.id,
            methodNode.id,
        ]);

        currentView = await scribeService.getDocument(documentId, testOrgId);
        tocNode = currentView.nodes.find(n => n.stationKey === "table_of_contents")!;
        expect(tocNode.content).toBe(
            "# Table of Contents\n\n1. [Results](#results)\n2. [Introduction](#intro)\n3. [Research Methodology & Protocols](#methodology)\n"
        );

        // 3. Add a station -> TOC should include new station
        const newStation = await scribeService.addStation(documentId, testOrgId, {
            title: "Discussion & Conclusion",
            stationKey: "discussion",
        });
        currentView = await scribeService.getDocument(documentId, testOrgId);
        tocNode = currentView.nodes.find(n => n.stationKey === "table_of_contents")!;
        expect(tocNode.content).toContain("4. [Discussion & Conclusion](#discussion)");

        // 4. Delete a station -> TOC should no longer include it
        await scribeService.deleteStation(newStation.id, testOrgId);
        currentView = await scribeService.getDocument(documentId, testOrgId);
        tocNode = currentView.nodes.find(n => n.stationKey === "table_of_contents")!;
        expect(tocNode.content).not.toContain("Discussion & Conclusion");
        expect(tocNode.content).toContain("1. [Results](#results)");
    });
});
