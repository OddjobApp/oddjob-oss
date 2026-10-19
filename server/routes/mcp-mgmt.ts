import { validateIdParam } from "@server/utils/api-utils.js";

import { Router } from "express";
import { db } from "@server/database_service.js";
import { mcpServers, insertMcpServerSchema, type McpServer } from "@shared/schema/index.js";
import { eq, desc } from "drizzle-orm";
import { mcpClientService } from "../domain/integrations/core/mcp-client.service.js";
import { z } from "zod";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("McpManagementRoutes");
export const mcpManagementRouter = Router();

// GET /api/mcp-servers - List all servers
mcpManagementRouter.get("/", async (req, res) => {
    try {
        const servers = await db.select().from(mcpServers).orderBy(desc(mcpServers.createdAt));
        res.json(servers);
    } catch (error) {
        logger.error("Failed to list MCP servers", error);
        res.status(500).json({ error: String(error) });
    }
});

// GET /api/mcp-servers/:id - Get details
mcpManagementRouter.get("/:id", async (req, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));

        if (!server) {
            return res.status(404).json({ error: "Server not found" });
        }
        res.json(server);
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// POST /api/mcp-servers - Create new server
mcpManagementRouter.post("/", async (req, res) => {
    try {
        const body = insertMcpServerSchema.parse(req.body);

        const [server] = await db.insert(mcpServers).values({
            ...body,
            status: "inactive" // Default to inactive until tested
        }).returning();

        res.status(201).json(server);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        logger.error("Failed to create MCP server", error);
        res.status(500).json({ error: String(error) });
    }
});

// POST /api/mcp-servers/suggest - Agent requests a new server
mcpManagementRouter.post("/suggest", async (req, res) => {
    try {
        const body = insertMcpServerSchema.parse(req.body);

        const [server] = await db.insert(mcpServers).values({
            ...body,
            status: "suggested"
        }).returning();

        res.status(201).json(server);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        logger.error("Failed to suggest MCP server", error);
        res.status(500).json({ error: String(error) });
    }
});

// PATCH /api/mcp-servers/:id - Update server
mcpManagementRouter.patch("/:id", async (req, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const body = insertMcpServerSchema.partial().parse(req.body);

        const [server] = await db.update(mcpServers)
            .set({ ...body, updatedAt: new Date() })
            .where(eq(mcpServers.id, id))
            .returning();

        if (!server) return res.status(404).json({ error: "Server not found" });

        // If config changed, reconnect if active
        if (server.status === "active") {
            try {
                await mcpClientService.connect(server.id);
            } catch (e) {
                // Return success but with warning? or jsut let status update to error handle it
            }
        }

        res.json(server);
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// DELETE /api/mcp-servers/:id - Delete server
mcpManagementRouter.delete("/:id", async (req, res) => {
    try {
        const id = validateIdParam(req.params.id);
        await mcpClientService.disconnect(id); // Ensure disconnected

        await db.delete(mcpServers).where(eq(mcpServers.id, id));
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// POST /api/mcp-servers/:id/connect - Connect/Refresh
mcpManagementRouter.post("/:id/connect", async (req, res) => {
    try {
        const id = validateIdParam(req.params.id);
        await mcpClientService.connect(id);

        const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
        res.json(server);
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// POST /api/mcp-servers/:id/disconnect
mcpManagementRouter.post("/:id/disconnect", async (req, res) => {
    try {
        const id = validateIdParam(req.params.id);
        await mcpClientService.disconnect(id);

        const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
        res.json(server);
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// GET /api/mcp-servers/tools - List all available tools across all servers
mcpManagementRouter.get("/tools", async (req, res) => {
    try {
        // This is useful for debugging what tools are actually loaded
        const tools = mcpClientService.getAllTools();

        // Strip out the execute function for serialization
        const safeTools = tools.map((t: any) => ({
            name: t.name,
            description: t.description,
            label: t.label,
            group: t.group,
            // parameters: t.parameters // Zod object not easily serializable, maybe just say "schema available"
        }));

        res.json(safeTools);
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

