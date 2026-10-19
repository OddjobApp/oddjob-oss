import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import type { AssemblyDraft } from "@domain/scaffold/process-synthesis.service.js";

/**
 * Reaching the files attached to this project.
 *
 * Retrieval, not stuffing: attachment text is NOT pasted into every prompt.
 * Six agents times a large PDF per round is a cost and context disaster that
 * also drowns the discussion — so each agent pulls only the passages its own
 * question needs.
 *
 * Both tools take their scope from the room's ToolContext rather than from
 * arguments. An agent cannot ask for another project's documents, because it
 * has no way to name one.
 */
/**
 * The room's numeric id, resolved from the sessionKey the crew context carries.
 *
 * The context has sessionKey, not sessionId — reading `context.sessionId`
 * yields undefined, which would make `thisRoomOnly` a filter that silently
 * does nothing. A scope that quietly fails open is worse than no scope.
 */
/** approverId carries an FK to users.id; crew passes the literal "crew". */
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveSessionId(context: ToolContext, orgId: number): Promise<number | null> {
    if ((context as any)?.sessionId != null) return Number((context as any).sessionId);
    const sessionKey = (context as any)?.sessionKey;
    if (!sessionKey) return null;
    const { db } = await import("@server/database_service.js");
    const { crewSessions } = await import("@shared/schema/index.js");
    const { and, eq } = await import("drizzle-orm");
    const [row] = await db
        .select({ id: crewSessions.id })
        .from(crewSessions)
        .where(and(eq(crewSessions.organizationId, orgId), eq(crewSessions.sessionKey, String(sessionKey))))
        .limit(1);
    return row?.id ?? null;
}

/**
 * A process draft as a Mermaid flowchart: its inputs, then its steps in order
 * with any branch condition on the edge into them, then the dataset table.
 * Labels are stripped of Mermaid syntax, because they come from a file or an
 * image the author attached.
 */
export function processDraftChart(draft: AssemblyDraft): string {
    const label = (value: string | null | undefined) =>
        String(value ?? "").replace(/["[\]{}()<>|#;`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    const lines = ["flowchart TD"];
    let previous: string | null = null;

    const inputs = draft.uiFields.map((field) => label(field.label || field.name)).filter(Boolean);
    if (inputs.length) {
        lines.push(`    inputs["Inputs: ${inputs.slice(0, 6).join(", ")}${inputs.length > 6 ? ", and more" : ""}"]`);
        previous = "inputs";
    }
    draft.steps.forEach((step, index) => {
        const id = `step${index + 1}`;
        lines.push(`    ${id}["${index + 1}. ${label(step.name) || "Step"} (${label(step.type) || "step"})"]`);
        if (previous) {
            const condition = label(step.celCondition);
            lines.push(condition ? `    ${previous} -->|if ${condition}| ${id}` : `    ${previous} --> ${id}`);
        }
        previous = id;
    });
    lines.push(`    table[("${label(draft.tableName) || "records"}")]`);
    if (previous) lines.push(`    ${previous} --> table`);
    return lines.join("\n");
}

export const ATTACHMENT_TOOLS: Record<string, ToolDefinition> = {
    search_attachments: {
        name: "search_attachments",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Search Attached Files",
        group: "Knowledge",
        riskLevel: "low",
        description:
            "Search the files attached to this project for passages relevant to a question. " +
            "Use this before answering anything about an uploaded document — it returns the actual text, " +
            "with the file each passage came from, so you can cite rather than recall.",
        parameters: z.object({
            query: z.string().min(2).describe("What you are looking for, in natural language"),
            limit: z.number().int().min(1).max(20).optional().default(6)
                .describe("How many passages to return"),
            thisRoomOnly: z.boolean().optional().default(false)
                .describe("Restrict to files attached in this room rather than the whole project"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const orgId = context?.organizationId != null ? Number(context.organizationId) : null;
            const projectId = (context as any)?.projectId != null ? Number((context as any).projectId) : null;
            if (orgId == null) return JSON.stringify({ error: "No organization in context." });
            const sessionId = await resolveSessionId(context, orgId);
            if (projectId == null && sessionId == null) {
                return JSON.stringify({
                    error: "This room is not scoped to a project or session, so it has no attached files to search.",
                });
            }

            const { attachmentIndexService } = await import(
                "@domain/knowledge/core/attachment-index.service.js"
            );
            const results = await attachmentIndexService.search({
                query: params.query,
                orgId,
                projectId: projectId ?? undefined,
                limit: params.limit ?? 6,
                sessionId: (params.thisRoomOnly || projectId == null)
                    ? (sessionId ?? undefined)
                    : undefined,
            });

            if (results.length === 0) {
                // An empty result is a finding. Saying "nothing matched" beats an
                // agent concluding the document does not exist.
                return JSON.stringify({
                    query: params.query,
                    matches: [],
                    note: "No attached file contained a passage matching that. The files may not be indexed yet — check list_attachments.",
                });
            }

            return JSON.stringify({
                query: params.query,
                matches: results.map((r) => ({
                    file: r.displayName,
                    attachmentId: r.attachmentId,
                    // Carried so a claim built on this can cite chunk-level
                    // provenance rather than just naming the file.
                    chunk: r.chunkIndex,
                    score: r.score,
                    text: r.content,
                })),
            });
        },
    },

    /**
     * Promotion is proposed, never done inline.
     *
     * Moving a room's file into the project knowledge base changes what EVERY
     * future agent can retrieve, and a document dropped into a private project
     * and promoted org-wide is a real exfiltration path — credentials and PII
     * inside a file do not announce themselves. So a human decides, through the
     * same gate propose_assembly_deployment uses.
     */
    propose_attachment_promotion: {
        name: "propose_attachment_promotion",

        idempotency: "idempotent",
        label: "Propose Filing an Attachment in the Knowledge Base",
        group: "Knowledge",
        riskLevel: "medium",
        description:
            "Propose filing an attached file into this project's knowledge base, so it is retrievable " +
            "beyond this room. Call list_attachments first and propose only an attachmentId that exists. " +
            "Requires human approval before it takes effect.",
        parameters: z.object({
            attachmentId: z.number().int().positive().describe("From list_attachments"),
            title: z.string().min(3).describe("Title to file it under in the knowledge base"),
            reason: z.string().describe("Why this belongs in the project's durable knowledge"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const orgId = context?.organizationId != null ? Number(context.organizationId) : null;
            const projectId = (context as any)?.projectId != null ? Number((context as any).projectId) : null;
            const projectKey = (context as any)?.projectKey ?? null;
            const requestedBy = context?.userId || "crew";
            if (orgId == null) return JSON.stringify({ error: "No organization in context." });
            if (projectId == null) {
                return JSON.stringify({ error: "This room is not scoped to a project." });
            }

            // Verified before proposing. A proposal that cannot be executed asks
            // a human to approve work that will fail.
            const { attachmentService } = await import("@domain/knowledge/core/attachment.service.js");
            const files = await attachmentService.listForProject(orgId, projectId);
            const file = files.find((f) => f.id === params.attachmentId);
            if (!file) {
                return JSON.stringify({
                    error: `No attachment ${params.attachmentId} in this project. Call list_attachments and use an id from it.`,
                });
            }
            if (file.parseStatus !== "parsed") {
                return JSON.stringify({
                    error: `"${file.displayName}" could not be read (${file.parseStatus}), so there is no content to file.`,
                });
            }

            let proposalId = Date.now();
            try {
                const { db } = await import("@server/database_service.js");
                const { approvalRequests } = await import("@shared/schema/index.js");
                const { v4: uuidv4 } = await import("uuid");
                const { randomBytes } = await import("crypto");

                const [inserted] = await db
                    .insert(approvalRequests)
                    .values({
                        executionId: `attachment_promotion_${uuidv4()}`,
                        toolName: "propose_attachment_promotion",
                        toolArgs: {
                            ...params,
                            kind: "attachment_promotion",
                            projectId,
                            projectKey,
                            displayName: file.displayName,
                        } as any,
                        approverType: "user",
                        ...(USER_ID_PATTERN.test(String(requestedBy)) ? { approverId: String(requestedBy) } : {}),
                        approverEmail: String(requestedBy),
                        status: "pending",
                        comments: params.reason,
                        organizationId: orgId,
                        token: randomBytes(16).toString("hex"),
                    })
                    .returning({ id: approvalRequests.id });
                if (inserted?.id) proposalId = inserted.id;
            } catch {
                // The proposal card still renders; the approval row is what a
                // human acts on, and its absence is logged by the caller.
            }

            return JSON.stringify({
                type: "approval_request",
                kind: "attachment_promotion",
                proposalId,
                title: `File "${file.displayName}" in ${projectKey || "this project"}'s knowledge base`,
                attachmentId: params.attachmentId,
                fileName: file.displayName,
                documentTitle: params.title,
                reason: params.reason,
                note: "Filing this makes it retrievable by every agent in this project, not just this room. " +
                    "It stays scoped to the project.",
            });
        },
    },

    /**
     * A drawn process becomes a buildable draft.
     *
     * Shown as a workflow diagram rather than deployed: the draft is something the
     * room can inspect and argue with, and shipping it still goes through
     * propose_assembly_deployment. That separation matters most for an
     * image-derived process, where the graph is an inference. (It mounted
     * FullStackAssemblyPod until that pod was retired for Form Studio.)
     */
    synthesize_app_from_process: {
        name: "synthesize_app_from_process",

        idempotency: "none",
        label: "Build an Assembly Draft From an Attached Process",
        group: "App Forge",
        riskLevel: "low",
        description:
            "Turn an attached BPMN file, workflow diagram, flowchart, or process image into an assembly draft shown as a workflow " +
            "diagram: inputs, pipeline steps in order, branch conditions and a dataset table. Call list_attachments first. " +
            "This drafts only; deploying still requires propose_assembly_deployment.",
        parameters: z.object({
            attachmentId: z.number().int().positive().describe("From list_attachments"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const orgId = context?.organizationId != null ? Number(context.organizationId) : null;
            let projectId = (context as any)?.projectId != null ? Number((context as any).projectId) : null;
            const projectKey = (context as any)?.projectKey ?? null;
            if (orgId == null) return JSON.stringify({ error: "No organization in context." });

            const sessionId = await resolveSessionId(context, orgId);
            if (projectId == null) {
                const { projectService } = await import("@domain/projects/core/project.service.js");
                projectId = await projectService.resolveDefaultProjectId(orgId);
            }
            if (projectId == null && sessionId == null) {
                return JSON.stringify({ error: "This room is not scoped to a project or session." });
            }

            const { db } = await import("@server/database_service.js");
            const { fileBlobs, crewAttachments } = await import("@shared/schema/index.js");
            const { and, eq } = await import("drizzle-orm");

            const conditions = [
                eq(crewAttachments.id, params.attachmentId),
                eq(crewAttachments.orgId, orgId),
            ];
            if (projectId != null) {
                conditions.push(eq(crewAttachments.projectId, projectId));
            } else if (sessionId != null) {
                conditions.push(eq(crewAttachments.sessionId, sessionId));
            }

            const [row] = await db
                .select({
                    displayName: crewAttachments.displayName,
                    parseType: fileBlobs.parseType,
                    parsedData: fileBlobs.parsedData,
                })
                .from(crewAttachments)
                .innerJoin(fileBlobs, eq(fileBlobs.id, crewAttachments.blobId))
                .where(and(...conditions))
                .limit(1);

            if (!row) return JSON.stringify({ error: `No attachment ${params.attachmentId} in this project or room.` });

            // Two shapes reach here: a parsed BPMN graph, and one inferred from
            // an image. They are deliberately the same structure so synthesis has
            // one input contract — but the provenance travels with it.
            const data = (row.parsedData ?? {}) as any;
            const parsedGraph = data?.content?.graph;
            const inferredGraph = data?.processGraph;
            const graph = parsedGraph ?? inferredGraph;

            if (!graph) {
                return JSON.stringify({
                    error: `"${row.displayName}" does not contain a process. ` +
                        (row.parseType === "image"
                            ? "The image was read but no workflow was recognised in it."
                            : "Attach a BPMN file or a diagram of a workflow."),
                });
            }

            const { processSynthesisService } = await import(
                "@domain/scaffold/process-synthesis.service.js"
            );
            const draft = processSynthesisService.synthesize({
                ...graph,
                provenance: parsedGraph ? "parsed" : "inferred",
                uncertainties: inferredGraph?.uncertainties ?? [],
            });

            const title = `${draft.displayName} — drafted from ${row.displayName}`;
            const chart = processDraftChart(draft);
            const note = draft.provenance === "inferred"
                ? "This process was READ FROM AN IMAGE and is an inference. Check the steps and conditions against the diagram before deploying."
                : "Drafted from the process definition. Review before deploying.";
            return JSON.stringify({
                success: true,
                type: "workflow_diagram",
                title,
                chart,
                markdownBlock: `\`\`\`mermaid\n${chart}\n\`\`\``,
                message: `${note}${draft.warnings.length ? ` Unresolved: ${draft.warnings.join(" ")}` : ""}`,
                // Carried onto the artifact so the room can see, without asking,
                // whether this came from a file or from a picture of one.
                provenance: draft.provenance,
                sourceAttachment: { id: params.attachmentId, name: row.displayName },
                projectKey: projectKey ?? "Unscoped",
                draft: {
                    appName: draft.displayName,
                    tableName: draft.tableName,
                    inputs: draft.uiFields,
                    steps: draft.steps.map((s) => ({ name: s.name, type: s.type, agent: s.agent, celCondition: s.celCondition })),
                    datasetFields: draft.datasetFields,
                },
                warnings: draft.warnings,
                note,
            });
        },
    },

    list_attachments: {
        name: "list_attachments",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Attached Files",
        group: "Knowledge",
        riskLevel: "low",
        description:
            "List the files attached to this project, with whether each one has been read and indexed. " +
            "Use this to see what is available before searching, or to explain why a search found nothing.",
        parameters: z.object({
            thisRoomOnly: z.boolean().optional().default(false),
        }),
        execute: async (params: any, context: ToolContext) => {
            const orgId = context?.organizationId != null ? Number(context.organizationId) : null;
            const projectId = (context as any)?.projectId != null ? Number((context as any).projectId) : null;
            if (orgId == null) return JSON.stringify({ error: "No organization in context." });
            const sessionId = await resolveSessionId(context, orgId);
            if (projectId == null && sessionId == null) {
                return JSON.stringify({ error: "This room is not scoped to a project or session." });
            }

            const { attachmentService } = await import("@domain/knowledge/core/attachment.service.js");
            const files = (params.thisRoomOnly || projectId == null) && sessionId != null
                ? await attachmentService.listForSession(orgId, Number(sessionId))
                : await attachmentService.listForProject(orgId, projectId!);

            return JSON.stringify({
                type: "assistant_table",
                title: (params.thisRoomOnly || projectId == null) ? "Files attached in this room" : "Files attached to this project",
                description: `${files.length} file${files.length === 1 ? "" : "s"}`,
                columns: [
                    { key: "name", label: "File", type: "text" },
                    { key: "kind", label: "Kind", type: "text" },
                    { key: "read", label: "Read", type: "text" },
                    { key: "searchable", label: "Searchable", type: "text" },
                ],
                rows: files.map((f) => ({
                    name: f.displayName,
                    kind: f.parseType ?? "—",
                    // Reported plainly. An unreadable file must not look like an
                    // empty one, and an unindexed file must not look absent.
                    read: f.parseStatus === "parsed"
                        ? `${f.textLength ?? 0} chars`
                        : f.parseStatus,
                    searchable: f.indexStatus === "indexed" ? "yes" : f.indexStatus,
                })),
            });
        },
    },

    get_attachment_text: {
        name: "get_attachment_text",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Attached File Text Content",
        group: "Knowledge",
        riskLevel: "low",
        description:
            "Retrieve the full extracted text content of an attached file (PDF, DOCX, Markdown, CSV, etc.) " +
            "to read requirements, form fields, schemas, or specifications. Pass either attachmentId or fileName.",
        parameters: z.object({
            attachmentId: z.number().int().positive().optional().describe("From list_attachments"),
            fileName: z.string().optional().describe("Or the display name of the attached file"),
            maxChars: z.number().int().min(100).max(50000).optional().default(20000).describe("Max characters to return"),
            offset: z.number().int().min(0).optional().default(0).describe("Character offset for long documents"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const orgId = context?.organizationId != null ? Number(context.organizationId) : null;
            const projectId = (context as any)?.projectId != null ? Number((context as any).projectId) : null;
            if (orgId == null) return JSON.stringify({ error: "No organization in context." });
            const sessionId = await resolveSessionId(context, orgId);
            if (projectId == null && sessionId == null) {
                return JSON.stringify({ error: "This room is not scoped to a project or session." });
            }

            const { db } = await import("@server/database_service.js");
            const { crewAttachments, fileBlobs } = await import("@shared/schema/index.js");
            const { and, eq, ilike } = await import("drizzle-orm");

            let condition;
            if (params.attachmentId) {
                condition = and(
                    eq(crewAttachments.orgId, orgId),
                    eq(crewAttachments.id, params.attachmentId)
                );
            } else if (params.fileName) {
                condition = and(
                    eq(crewAttachments.orgId, orgId),
                    ilike(crewAttachments.displayName, `%${params.fileName.trim()}%`),
                    sessionId != null ? eq(crewAttachments.sessionId, sessionId) : undefined
                );
            } else {
                // Default: get latest attachment in session
                condition = and(
                    eq(crewAttachments.orgId, orgId),
                    sessionId != null ? eq(crewAttachments.sessionId, sessionId) : undefined
                );
            }

            const [row] = await db
                .select({
                    id: crewAttachments.id,
                    displayName: crewAttachments.displayName,
                    parseStatus: fileBlobs.parseStatus,
                    parseType: fileBlobs.parseType,
                    parsedText: fileBlobs.parsedText,
                    textLength: fileBlobs.textLength,
                })
                .from(crewAttachments)
                .innerJoin(fileBlobs, eq(fileBlobs.id, crewAttachments.blobId))
                .where(condition)
                .orderBy(eq(crewAttachments.id, crewAttachments.id))
                .limit(1);

            if (!row) {
                return JSON.stringify({
                    error: `No attachment found matching criteria. Call list_attachments to see available files.`,
                });
            }

            if (row.parseStatus !== "parsed" || !row.parsedText) {
                return JSON.stringify({
                    file: row.displayName,
                    attachmentId: row.id,
                    parseStatus: row.parseStatus,
                    error: `Attachment "${row.displayName}" could not be read or has no extracted text.`,
                });
            }

            const offset = params.offset || 0;
            const maxChars = params.maxChars || 20000;
            const slice = row.parsedText.slice(offset, offset + maxChars);

            return JSON.stringify({
                file: row.displayName,
                attachmentId: row.id,
                totalChars: row.textLength || row.parsedText.length,
                offset,
                returnedChars: slice.length,
                hasMore: (offset + slice.length) < (row.textLength || row.parsedText.length),
                content: slice,
            });
        },
    },

    /**
     * Fetch a remote file and attach it to this room.
     *
     * The gap this closes: a person pastes a URL — a county PDF, a CSV export —
     * and the room had no way to bring the bytes in. Agents reached for
     * `upload_attachment` (which does not exist) or narrated an upload for
     * rounds on end. After this runs, the ordinary tools apply:
     * get_attachment_text reads it, search_attachments finds it.
     */
    attach_url: {
        name: "attach_url",
        // Fetches the same URL twice returns the same attachment: blobs dedupe
        // by content hash and re-attaching the same blob to a room is a no-op.
        idempotency: "idempotent",
        label: "Attach a File From a URL",
        group: "Knowledge",
        // Medium, not low: it fetches a caller-supplied URL and persists the
        // result as durable, indexed room content. Only `riskLevel: "high"`
        // changes runtime behaviour (server/mcp/handlers.ts gates approval on
        // it), so this sharpens the generated capability page without
        // silently introducing an approval step.
        riskLevel: "medium",
        guardrails: [
            "The URL and every redirect hop are validated by EgressFirewall, which refuses non-HTTP(S) schemes and loopback, private, link-local, CGNAT and reserved addresses in both IPv4 and IPv6 form.",
            "When AGENT_EGRESS_WHITELIST is configured, only the listed domains are reachable.",
            "At most 5 redirects, a 45-second timeout, and a 25 MB ceiling checked against both the declared Content-Length and the received body.",
            "The file is attached only to the room's own project; a room with no project is refused.",
        ],
        sideEffects: ["external-api", "database"],
        description:
            "Fetch a file from a URL the user supplied (PDF, CSV, JSON, image, or page) and attach it to this room, " +
            "where it is parsed and indexed. Use this whenever the user gives you a link to a document or data file " +
            "instead of an upload — do NOT describe uploading it. Afterwards call get_attachment_text or " +
            "search_attachments to read it.",
        parameters: z.object({
            url: z.string().url().describe("The http(s) URL to fetch"),
            fileName: z.string().optional().describe("Display name override; defaults to the URL's filename"),
        }),
        execute: async (params: { url: string; fileName?: string }, context: ToolContext) => {
            const orgId = context?.organizationId != null ? Number(context.organizationId) : null;
            if (orgId == null) return JSON.stringify({ error: "No organization in context." });
            const sessionId = await resolveSessionId(context, orgId);
            if (sessionId == null) {
                return JSON.stringify({ error: "Attachments need a room. This call has no session, so there is nowhere to put the file." });
            }
            let projectId = (context as any)?.projectId != null ? Number((context as any).projectId) : null;
            if (projectId == null) {
                const { projectService } = await import("@domain/projects/core/project.service.js");
                projectId = await projectService.resolveDefaultProjectId(orgId);
            }
            if (projectId == null) {
                return JSON.stringify({ error: "This room is not scoped to a project, so there is nowhere to attach the file." });
            }

            const { EgressFirewall } = await import("@server/utils/egress-firewall.js");

            const MAX_BYTES = 25 * 1024 * 1024;
            let buffer: Buffer;
            let mimeType: string;
            let name: string;
            try {
                // Every redirect hop goes through the firewall — `redirect:
                // "follow"` would let a public URL hand the request to a
                // private one. The hop loop this used to carry by hand now
                // lives in EgressFirewall.fetch, shared with the HTTP
                // connector and browse_web.
                const guarded = await EgressFirewall.fetch(params.url, {
                    signal: AbortSignal.timeout(45_000),
                    headers: { "User-Agent": "Oddjob-Attachment/1.0", Accept: "*/*" },
                });
                if (!guarded.allowed) {
                    return JSON.stringify({ error: `Request blocked by Egress Firewall: ${guarded.reason}` });
                }
                const res = guarded.response!;
                if (!res.ok) throw new Error(`HTTP ${res.status} from the remote server`);
                const length = Number(res.headers.get("content-length") ?? 0);
                if (length > MAX_BYTES) throw new Error(`The file is ${length} bytes; the limit is ${MAX_BYTES}`);
                buffer = Buffer.from(await res.arrayBuffer());
                if (buffer.byteLength === 0) throw new Error("The URL returned an empty response");
                if (buffer.byteLength > MAX_BYTES) throw new Error(`The file is ${buffer.byteLength} bytes; the limit is ${MAX_BYTES}`);

                const disposition = res.headers.get("content-disposition") ?? "";
                const fromHeader = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(disposition)?.[1];
                const fromPath = decodeURIComponent(new URL(params.url).pathname.split("/").pop() ?? "");
                name = params.fileName?.trim() || fromHeader || (fromPath && fromPath.includes(".") ? fromPath : "") || "downloaded-file";
                mimeType = (res.headers.get("content-type") ?? "").split(";")[0].trim()
                    || ({ pdf: "application/pdf", csv: "text/csv", json: "application/json", txt: "text/plain", md: "text/markdown" } as Record<string, string>)[name.split(".").pop()?.toLowerCase() ?? ""]
                    || "application/octet-stream";
            } catch (error: any) {
                return JSON.stringify({ error: `Could not fetch ${params.url}: ${error?.message ?? error}` });
            }

            const { attachmentService } = await import("@domain/knowledge/core/attachment.service.js");
            const { attachment, blob } = await attachmentService.attachToRoom({
                orgId,
                projectId,
                sessionId,
                buffer,
                originalName: name,
                mimeType,
                uploadedBy: context?.userId ?? "crew",
            });

            return JSON.stringify({
                type: "attachment_attached",
                attachmentId: attachment.id,
                name: attachment.displayName ?? name,
                byteSize: blob.byteSize,
                mimeType: blob.mimeType,
                // Parse/index state is reported, not smoothed over: a failed
                // parse is a fact the agent must relay rather than paper over.
                parseStatus: blob.parseStatus,
                textLength: blob.textLength ?? null,
                note:
                    `"${name}" is attached to this room` +
                    (blob.parseStatus === "parsed"
                        ? ` and readable (${blob.textLength ?? 0} chars — call get_attachment_text with attachmentId ${attachment.id} to read it).`
                        : `, but could not be read (${blob.parseStatus}). It is stored; its content is not available.`),
            });
        },
    },
};
