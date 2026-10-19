
import { Router } from "express";
import { z } from "zod";
import { OllamaService } from "@domain/ai/core/ollama.service.js";
import { requireAuth } from "@domain/core/auth/security.service.js";

const router = Router();

// Schema for connecting
const connectionSchema = z.object({
    baseUrl: z.string().url().default("http://localhost:11434"),
});

// GET /api/ollama/version
router.get("/version", async (req, res) => {
    const baseUrl = (req.query.baseUrl as string) || "http://localhost:11434";
    const service = new OllamaService(baseUrl);
    const info = await service.getVersion();
    if (!info) {
        return res.status(503).json({ error: "Ollama service unreachable" });
    }
    res.json(info);
});

// GET /api/ollama/tags
router.get("/tags", async (req, res) => {
    const baseUrl = (req.query.baseUrl as string) || "http://localhost:11434";
    const service = new OllamaService(baseUrl);
    try {
        const models = await service.listModels();
        res.json({ models });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// POST /api/ollama/pull
router.post("/pull", requireAuth, async (req, res) => {
    const schema = z.object({
        baseUrl: z.string().url().default("http://localhost:11434"),
        name: z.string().min(1),
    });

    const parse = schema.safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({ error: parse.error });
    }

    const { baseUrl, name } = parse.data;
    const service = new OllamaService(baseUrl);

    try {
        // This triggers the pull. Real-time progress would need generic streaming support or SSE.
        // For now we just return "accepted"
        service.pullModel(name); // Don't await full completion if it's long?
        // Actually standard fetch awaits the response headers. 
        // Ollama streaming response might keep this open.
        // Let's just return 202 Accepted.
        res.status(202).json({ status: "pull_started", model: name });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// DELETE /api/ollama/delete
router.delete("/delete", requireAuth, async (req, res) => {
    const schema = z.object({
        baseUrl: z.string().url().default("http://localhost:11434"),
        name: z.string().min(1),
    });

    const parse = schema.safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({ error: parse.error });
    }

    const { baseUrl, name } = parse.data;
    const service = new OllamaService(baseUrl);

    try {
        const success = await service.deleteModel(name);
        res.json({ success });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// GET /api/ollama/search?query=...
router.get("/search", async (req, res) => {
    const query = (req.query.query as string) || "";
    const service = new OllamaService();
    const results = service.searchRemoteModels(query);
    res.json({ results });
});

export default router;

