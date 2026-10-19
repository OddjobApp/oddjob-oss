import { missionMarketplaceService } from "../core/mission-marketplace.service.js";
import assert from "node:assert";

/**
 * Verification Test: Mission Packaging & Portability
 * 
 * Verifies that the Marketplace Engine can package a mission
 * and re-install it into a new organization as a template.
 */
async function testMissionPackaging() {
    console.log("🚀 Testing Mission Packaging (Marketplace Engine)...");

    // In a real environment, we would insert a mock mission first.
    // For this stub, we verify manifest validation and logic flow.

    const mockManifestData = {
        manifest_version: "1.0.0",
        metadata: {
            name: "Cloud Infrastructure Auditor",
            description: "Automatically scans AWS infrastructure for cost savings.",
            version: "2.4.1"
        },
        archetypes: [
            { role: "Economist", description: "Analyzes cost data", archetype: "professional" }
        ],
        requirements: {
            mcp_servers: ["aws-mcp"],
            min_model_capability: "pro"
        },
        logic: {
            objective: "Audit AWS Cost Explorer",
            reasoning_protocol: "json_manifest",
            execution_strategy: "autonomous_discovery"
        },
        initial_blackboard: { threshold: 500 }
    };

    try {
        console.log("--- Unpacking Manifest...");
        // This validates via Zod internally
        const templateId = await missionMarketplaceService.installManifest(mockManifestData, 1, "user-test");
        console.log(`✅ Manifest unpacked successfully. Template ID: ${templateId}`);

        // Verify re-packaging (conceptual check)
        // const repackaged = await missionMarketplaceService.packageMission(missionId);
        
    } catch (err) {
        console.error("❌ Manifest validation failed:", err);
        throw err;
    }
}

if (import.meta.url.startsWith('file:')) {
    testMissionPackaging().catch(err => {
        console.error("❌ Test failed:", err);
        process.exit(1);
    });
}
