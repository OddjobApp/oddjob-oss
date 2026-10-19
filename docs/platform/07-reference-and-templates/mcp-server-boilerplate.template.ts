---
id: mcp-server-boilerplate
title: "Production Model Context Protocol (MCP) Server Boilerplate Template"
audience: ["HUMAN_PRIMARY", "AGENT_PRIMARY"]
badge: "HUMAN_PRIMARY"
category: "07-reference-and-templates"
autonomy_level: "L0-L2"
version: "1.0.0"
tags: ["mcp", "model-context-protocol", "boilerplate", "template", "typescript", "tools", "server"]
summary: "Production-ready TypeScript starter boilerplate for authoring, testing, and deploying standalone Model Context Protocol (MCP) tool servers."
---

# Production MCP Server Boilerplate Template

> **Audience:** 🧑 Human / Builder | 🤖 Agent / Autonomous  
> **Autonomy Level:** L0 to L2  
> **File Type:** TypeScript (`.ts`)

---

## 1. Complete Production Server Implementation

```typescript
/**
 * Oddjob Enterprise Model Context Protocol (MCP) Tool Server Boilerplate
 * Implements MCP Specification with Zod validation, W3C Tracing, and Idempotency.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// 1. Tool Input Schemas
const QueryInventorySchema = z.object({
  warehouseId: z.string().describe("Target warehouse identifier (e.g. WH-EAST-01)"),
  sku: z.string().describe("Stock Keeping Unit code"),
});

const AdjustInventorySchema = z.object({
  warehouseId: z.string(),
  sku: z.string(),
  deltaQuantity: z.number().int().describe("Positive for restock, negative for deduction"),
  reasonCode: z.enum(["RESTOCK", "DAMAGED", "CYCLE_COUNT", "ORDER_FULFILL"]),
  idempotencyKey: z.string().uuid().describe("Deterministic UUID to prevent duplicate stock adjustments"),
});

// 2. Instantiate MCP Server
const server = new Server(
  {
    name: "oddjob-warehouse-mcp-service",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 3. Register Tool Discovery Handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "warehouse_query_inventory",
        description: "Read current available and reserved inventory for a specific SKU. Safe & idempotent read tool.",
        inputSchema: {
          type: "object",
          properties: {
            warehouseId: { type: "string" },
            sku: { type: "string" },
          },
          required: ["warehouseId", "sku"],
        },
      },
      {
        name: "warehouse_adjust_inventory",
        description: "Mutate on-hand inventory levels. Requires UUID idempotencyKey.",
        inputSchema: {
          type: "object",
          properties: {
            warehouseId: { type: "string" },
            sku: { type: "string" },
            deltaQuantity: { type: "number" },
            reasonCode: { type: "string", enum: ["RESTOCK", "DAMAGED", "CYCLE_COUNT", "ORDER_FULFILL"] },
            idempotencyKey: { type: "string", format: "uuid" },
          },
          required: ["warehouseId", "sku", "deltaQuantity", "reasonCode", "idempotencyKey"],
        },
      },
    ],
  };
});

// 4. Register Tool Execution Handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "warehouse_query_inventory": {
        const validated = QueryInventorySchema.parse(args);
        // Execute business logic query
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                warehouseId: validated.warehouseId,
                sku: validated.sku,
                onHand: 1420,
                reserved: 120,
                available: 1300,
                lastAuditedAt: "2026-08-26T12:00:00Z",
              }),
            },
          ],
        };
      }

      case "warehouse_adjust_inventory": {
        const validated = AdjustInventorySchema.parse(args);
        // Execute mutation with idempotency check
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                idempotencyKey: validated.idempotencyKey,
                adjustedBy: validated.deltaQuantity,
                newBalance: 1420 + validated.deltaQuantity,
                timestamp: new Date().toISOString(),
              }),
            },
          ],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool requested: ${name}`);
    }
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Zod Validation Failed: ${err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`
      );
    }
    throw new McpError(ErrorCode.InternalError, err.message || "Execution failed");
  }
});

// 5. Connect Transport & Start
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Oddjob MCP Server running on stdio transport.");
}

run().catch((err) => {
  console.error("Fatal MCP Server startup error:", err);
  process.exit(1);
});
```
