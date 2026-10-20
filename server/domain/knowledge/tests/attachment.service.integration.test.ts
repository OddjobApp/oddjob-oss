import { describe, expect, it, beforeAll, afterEach, afterAll } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { eq, inArray } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { fileBlobs, crewAttachments, crewSessions, projects } from "@shared/schema/index.js";

/**
 * Runs against oddjob_test, never dev, and writes blobs into a temp directory
 * rather than the repo's uploads tree.
 */
const ORG = 1;
// Its own project: a hardcoded id (19) existed only in long-lived databases, so on a
// fresh one, as in CI, every insert that referenced it failed its foreign key.
let PROJECT: number;

async function createProject(): Promise<number> {
    const [row] = await db
        .insert(projects)
        .values({ organizationId: ORG, key: `it-project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: "Integration test project", createdBy: "integration-test" })
        .returning({ id: projects.id });
    return row.id;
}

let storageRoot: string;
let sessionIds: number[] = [];
let blobIds: number[] = [];
let attachmentService: typeof import("../core/attachment.service.js")["attachmentService"];

beforeAll(async () => {
    PROJECT = await createProject();
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oddjob-attach-"));
    process.env.ATTACHMENT_STORAGE_ROOT = storageRoot;
    ({ attachmentService } = await import("../core/attachment.service.js"));
});

afterEach(async () => {
    if (sessionIds.length) await db.delete(crewSessions).where(inArray(crewSessions.id, sessionIds));
    if (blobIds.length) await db.delete(fileBlobs).where(inArray(fileBlobs.id, blobIds));
    sessionIds = [];
    blobIds = [];
});

afterAll(async () => {
    await fs.rm(storageRoot, { recursive: true, force: true });
    if (PROJECT) await db.delete(projects).where(eq(projects.id, PROJECT)).catch(() => {});
});

async function makeRoom(key: string) {
    const [row] = await db
        .insert(crewSessions)
        .values({ organizationId: ORG, sessionKey: key, projectId: PROJECT, title: key })
        .returning({ id: crewSessions.id });
    sessionIds.push(row.id);
    return row.id;
}

const attach = async (sessionId: number, name: string, body: string, mime = "text/plain") => {
    const result = await attachmentService.attachToRoom({
        orgId: ORG, projectId: PROJECT, sessionId,
        buffer: Buffer.from(body), originalName: name, mimeType: mime, uploadedBy: "tester",
    });
    if (!blobIds.includes(result.blob.id)) blobIds.push(result.blob.id);
    return result;
};

describe("attachmentService", () => {
    it("stores the bytes, so an attachment survives the conversation", async () => {
        const session = await makeRoom(`crew-store-${Date.now()}`);

        const { blob } = await attach(session, "notes.txt", "the actual content");

        // The Copilot path caches parsed text in Redis under a TTL and writes
        // nothing; this is the difference that makes a Files tab possible.
        await expect(fs.readFile(blob.storagePath, "utf-8")).resolves.toBe("the actual content");
    });

    it("parses once and reuses the blob for identical bytes", async () => {
        const roomA = await makeRoom(`crew-a-${Date.now()}`);
        const roomB = await makeRoom(`crew-b-${Date.now()}`);

        const first = await attach(roomA, "deck.txt", "same bytes");
        const second = await attach(roomB, "renamed-deck.txt", "same bytes");

        expect(second.blob.id).toBe(first.blob.id);
        // Different rooms, different names, one stored file.
        expect(second.attachment.id).not.toBe(first.attachment.id);
        expect(second.attachment.displayName).toBe("renamed-deck.txt");
    });

    it("re-attaching the same file to the same room does not duplicate it", async () => {
        const session = await makeRoom(`crew-dup-${Date.now()}`);

        await attach(session, "spec.txt", "identical");
        await attach(session, "spec.txt", "identical");

        expect(await attachmentService.listForSession(ORG, session)).toHaveLength(1);
    });

    it("records the full length so a preview cannot pass as the whole document", async () => {
        const session = await makeRoom(`crew-len-${Date.now()}`);
        const long = "x".repeat(50_000);

        const { blob } = await attach(session, "contract.txt", long);
        const [summary] = await attachmentService.listForSession(ORG, session);

        // An attachment keeps its FULL text now — truncation is opt-in, and this
        // path does not opt in. The preview is explicitly a preview.
        expect(blob.textLength).toBe(50_000);
        expect(blob.parsedText!.length).toBe(50_000);
        expect(summary.textLength).toBe(50_000);
        expect(summary.preview!.length).toBeLessThan(500);
    });

    it("extracts a process graph from an attached BPMN file", async () => {
        const session = await makeRoom(`crew-bpmn-${Date.now()}`);
        const bpmn = `<definitions><process id="P" name="Onboarding">
            <userTask id="T1" name="Collect details" />
            <sequenceFlow id="F1" sourceRef="T1" targetRef="T2" />
        </process></definitions>`;

        const { blob } = await attach(session, "flow.bpmn", bpmn, "application/xml");

        expect(blob.parseType).toBe("bpmn");
        expect((blob.parsedData as any)?.content?.graph?.processName).toBe("Onboarding");
    });

    it("reports an attachment as not indexed until something indexes it", async () => {
        const session = await makeRoom(`crew-idx-${Date.now()}`);

        await attach(session, "notes.txt", "content");
        const [summary] = await attachmentService.listForSession(ORG, session);

        // "pending" is a real state. It must not be indistinguishable from
        // indexed-and-empty, which is the failure that killed RAG before.
        expect(summary.indexStatus).toBe("pending");
        expect(summary.parseStatus).toBe("parsed");
    });

    it("lists a project's attachments with the room each came from", async () => {
        const session = await makeRoom(`crew-proj-${Date.now()}`);
        await attach(session, "brief.txt", `unique ${Date.now()}`);

        const listed = await attachmentService.listForProject(ORG, PROJECT);
        const mine = listed.find((a) => a.displayName === "brief.txt");

        expect(mine?.sessionKey).toBeTruthy();
    });

    it("will not read an attachment through a different project", async () => {
        const session = await makeRoom(`crew-scope-${Date.now()}`);
        const { attachment } = await attach(session, "secret.txt", `confidential ${Date.now()}`);

        expect(await attachmentService.readBlob(ORG, PROJECT, attachment.id)).not.toBeNull();
        // The whole point of scoping: another project cannot reach it.
        expect(await attachmentService.readBlob(ORG, PROJECT + 999, attachment.id)).toBeNull();
    });
});
