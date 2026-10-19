/**
 * Editing a project file in place is a WRITE, and was gated like a read.
 *
 * The route called getProject — which authorizes reading, and admits the whole
 * organization to an `org`-visible project and a viewer to a private one — and
 * then overwrote the file's contents. Every other mutating project operation
 * goes through assertRole(..., "editor"); this one went through nothing. The
 * new text is also reindexed into the corpus agents search, so the same gap
 * let a read-only caller plant text the agents would later retrieve.
 *
 * The size caps are here for the same reason the gate is: the handler reads a
 * whole blob into memory to answer with it, and attachments are accepted up to
 * 50MB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { projectService, attachmentService, indexAttachment } = vi.hoisted(() => ({
    projectService: {
        getProject: vi.fn(async () => ({ id: 11, key: "atlas", organizationId: 7, visibility: "org" })),
        assertCanEdit: vi.fn(async () => {}),
    },
    attachmentService: {
        readBlob: vi.fn(async () => ({
            displayName: "brief.md",
            mimeType: "text/markdown",
            bytes: Buffer.from("# Brief\n"),
        })),
        updateText: vi.fn(async () => ({ attachmentId: 5, byteSize: 8, textLength: 8 })),
    },
    indexAttachment: vi.fn(async () => {}),
}));

vi.mock("@domain/core/auth/security.service.js", () => ({
    requireAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@server/utils/auth-context.js", () => ({
    getUserOrgContext: vi.fn(async () => ({
        userId: "reader-1",
        organizationId: 7,
        isAdmin: false,
        isSuperAdmin: false,
        isOrgAdmin: false,
    })),
    assertOrgId: (value: number | null) => value,
}));

vi.mock("../core/project.service.js", () => ({ projectService }));
vi.mock("@domain/knowledge/core/attachment.service.js", () => ({ attachmentService }));
vi.mock("@domain/knowledge/core/attachment-index.service.js", () => ({
    attachmentIndexService: { indexAttachment },
}));

const { default: projectsRouter } = await import("../routes/projects.route.js");
const { errorHandler } = await import("@server/middleware/error-handler.js");

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use("/api/projects", projectsRouter);
app.use(errorHandler);

beforeEach(() => {
    vi.clearAllMocks();
    projectService.getProject.mockResolvedValue({
        id: 11, key: "atlas", organizationId: 7, visibility: "org",
    } as any);
    projectService.assertCanEdit.mockResolvedValue(undefined as any);
    attachmentService.readBlob.mockResolvedValue({
        displayName: "brief.md",
        mimeType: "text/markdown",
        bytes: Buffer.from("# Brief\n"),
    } as any);
});

describe("PATCH /api/projects/:key/files/:id/content", () => {
    it("asks for the editor role before writing", async () => {
        await request(app)
            .patch("/api/projects/atlas/files/5/content")
            .send({ content: "# Edited\n" })
            .expect(200);

        expect(projectService.assertCanEdit).toHaveBeenCalledTimes(1);
        expect(attachmentService.updateText).toHaveBeenCalledTimes(1);
    });

    it("refuses a caller who may read the project but not change it", async () => {
        const forbidden: any = new Error("This action requires the 'editor' role on project 'atlas'.");
        forbidden.statusCode = 403;
        projectService.assertCanEdit.mockRejectedValueOnce(forbidden);

        const res = await request(app)
            .patch("/api/projects/atlas/files/5/content")
            .send({ content: "planted by a viewer" })
            .expect(403);

        expect(res.body.error.message).toMatch(/editor/i);
        // The point of the gate: nothing was written, and nothing was indexed.
        expect(attachmentService.updateText).not.toHaveBeenCalled();
        expect(indexAttachment).not.toHaveBeenCalled();
    });

    it("rejects a body past the editable size, before reaching the service", async () => {
        const res = await request(app)
            .patch("/api/projects/atlas/files/5/content")
            .send({ content: "x".repeat(1024 * 1024 + 1) })
            .expect(400);

        expect(res.body.error.message).toMatch(/too large to save/i);
        expect(attachmentService.updateText).not.toHaveBeenCalled();
    });

    it("measures the limit in bytes, not characters", async () => {
        // Comfortably under a 1M-CHARACTER limit, comfortably over 1MB encoded.
        await request(app)
            .patch("/api/projects/atlas/files/5/content")
            .send({ content: "é".repeat(600_000) })
            .expect(400);

        expect(attachmentService.updateText).not.toHaveBeenCalled();
    });
});

describe("GET /api/projects/:key/files/:id/content", () => {
    it("returns a text file the editor can hold", async () => {
        const res = await request(app)
            .get("/api/projects/atlas/files/5/content")
            .expect(200);

        expect(res.body).toEqual({ content: "# Brief\n", displayName: "brief.md" });
    });

    it("refuses to load a file too large to edit", async () => {
        attachmentService.readBlob.mockResolvedValueOnce({
            displayName: "huge.log",
            mimeType: "text/plain",
            bytes: Buffer.alloc(1024 * 1024 + 1, 0x61),
        } as any);

        const res = await request(app)
            .get("/api/projects/atlas/files/5/content")
            .expect(400);

        expect(res.body.error.message).toMatch(/too large to open/i);
    });

    it("still refuses a file that is not text at all", async () => {
        attachmentService.readBlob.mockResolvedValueOnce({
            displayName: "diagram.png",
            mimeType: "image/png",
            bytes: Buffer.from([0x89, 0x50]),
        } as any);

        await request(app).get("/api/projects/atlas/files/5/content").expect(400);
    });
});
