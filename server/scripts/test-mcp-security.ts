
import { governorService } from "@domain/governor/core/governor-service.js";
import { createLogger } from "@server/utils/logger.js";
import type { GovernorPolicyRule } from "@shared/schema/governor.js";

const logger = createLogger("TestMcpSecurity");

async function runTest() {
    logger.info("Starting MCP Security Test...");

    const mockRules: GovernorPolicyRule[] = [
        {
            id: 1,
            policyId: 0,
            createdAt: new Date(),
            type: "mcp_server_deny",
            isEnabled: true,
            configuration: { servers: ["blocked-server"] }
        },
        {
            id: 2,
            policyId: 0,
            createdAt: new Date(),
            type: "mcp_tool_deny",
            isEnabled: true,
            configuration: { serverName: "allowed-server", tools: ["unsafe-tool"] }
        },
        {
            id: 3,
            policyId: 0,
            createdAt: new Date(),
            type: "mcp_server_allow",
            isEnabled: true,
            configuration: { servers: ["allowed-server", "essential-server"] }
        }
    ];

    try {
        logger.info("Test 1: Normal access to allowed server...");
        governorService.validateMcpPermission("allowed-server", "safe-tool", mockRules);
        logger.info("Test 1 Result: SUCCESS (Allowed)");
    } catch (e: any) {
        logger.error(`Test 1 Result: FAILED (${e.message})`);
    }

    try {
        logger.info("Test 2: Access to blocked server...");
        governorService.validateMcpPermission("blocked-server", "any-tool", mockRules);
        logger.info("Test 2 Result: FAILED (Should have been blocked)");
    } catch (e: any) {
        logger.info(`Test 2 Result: SUCCESS (Blocked: ${e.message})`);
    }

    try {
        logger.info("Test 3: Access to blocked tool on allowed server...");
        governorService.validateMcpPermission("allowed-server", "unsafe-tool", mockRules);
        logger.info("Test 3 Result: FAILED (Should have been blocked)");
    } catch (e: any) {
        logger.info(`Test 3 Result: SUCCESS (Blocked: ${e.message})`);
    }

    try {
        logger.info("Test 4: Access to server not in allowlist...");
        governorService.validateMcpPermission("unknown-server", "tool", mockRules);
        logger.info("Test 4 Result: FAILED (Should have been blocked by allowlist)");
    } catch (e: any) {
        logger.info(`Test 4 Result: SUCCESS (Blocked by allowlist: ${e.message})`);
    }
}

runTest().catch(console.error);

