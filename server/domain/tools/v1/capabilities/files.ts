import { z } from "zod";
import { fileStorageSuccess } from "@domain/knowledge/core/file-storage.js";
import type { ToolDefinition, ToolContext } from "./types.js";

export const FILE_TOOLS: Record<string, ToolDefinition> = {
    file_list: {
        name: "file_list",

        idempotency: "read-safe",
        label: "List Files (Storage)",
        group: "Files & Storage",
        description: "List files in a directory within the organization storage.",
        parameters: z.object({
            path: z.string().describe("Relative path to list (e.g., 'incoming' or 'reports')"),
            recursive: z.boolean().optional().describe("Whether to list recursively"),
        }),
        execute: async ({ path, recursive }: any, context: ToolContext) => {
            try {
                // Determine org context from the job context
                const orgId = context?.organizationId ?? null;
                const files = await fileStorageSuccess.listFiles(orgId as any, path, '**/*', recursive);
                if (files.length === 0) return "No files found.";
                return files.map(f => `${f.isDirectory ? '[DIR] ' : ''}${f.path} (${f.size} bytes)`).join("\n");
            } catch (e: any) {
                return `Error listing files: ${e.message}`;
            }
        },
    },
    file_read: {
        name: "file_read",

        idempotency: "read-safe",
        label: "Read File (Storage)",
        group: "Files & Storage",
        description: "Read the content of a file from organization storage. **MANDATORY**: You must provide the 'path' parameter as a relative path to the file.",
        parameters: z.object({
            path: z.string().optional().describe("Relative path to the file within storage (e.g., 'reports/analysis.md')"),
            filename: z.string().optional().describe("Alias for path"),
        }).refine(data => data.path || data.filename, {
            message: "Either 'path' or 'filename' must be provided",
            path: ["path"]
        }),
        execute: async (args: any, context: ToolContext) => {
            const { path: rawPath, filename } = args;
            const path = rawPath || filename;
            if (!path) return "Error: Path is required.";

            try {
                const orgId = context?.organizationId ?? null;
                const { FileStorageService } = await import("@domain/knowledge/core/file-storage.js");
                const { FileParser } = await import("@domain/core/infrastructure/file-parser.service.js");
                const storage = new FileStorageService();

                const buffer = await storage.readBuffer(orgId as any, path);
                const mimetype = path.endsWith('.pdf') ? 'application/pdf' :
                    path.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
                        path.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
                            path.endsWith('.csv') ? 'text/csv' : 'text/plain';

                const parsed = await FileParser.parse(buffer, mimetype, path);

                let content = parsed.summary || "";
                if (parsed.type === 'text') {
                    content = parsed.content;
                } else if (parsed.type === 'table' || parsed.type === 'json') {
                    content = `${parsed.summary}\n\nFull Data (truncated if large):\n${JSON.stringify(parsed.content, null, 2).slice(0, 5000)}`;
                }

                /*
                  Any other parse type falls back to `parsed.summary`, which DESCRIBES
                  the file rather than containing it. An agent asked to read a .txt then
                  gets told the file exists but never sees a line of it, reads that as a
                  broken tool, and escalates — in one run it requested a high-risk `shell`
                  approval to `cat` the file instead. For a text-typed file, decode the
                  buffer we already have rather than reporting availability as content.
                */
                if (!content.trim() && mimetype === 'text/plain') {
                    content = buffer.toString('utf-8');
                }
                if (!content.trim()) {
                    return `File '${path}' was read but no textual content could be extracted from it ` +
                        `(parser type: ${parsed.type ?? 'unknown'}, ${buffer.length} bytes). ` +
                        `It may be binary or empty — do not retry this file with another tool.`;
                }

                // Truncate if too long (LLM context limit)
                const maxLength = 10000;
                if (content.length > maxLength) {
                    return content.substring(0, maxLength) + `\n...(truncated, total ${content.length} chars)`;
                }
                return content;
            } catch (e: any) {
                return `Error reading file: ${e.message}`;
            }
        },
    },
    file_write: {
        name: "file_write",

        idempotency: "none",
        riskLevel: "high",
        label: "Write File (Storage)",
        group: "Files & Storage",
        description: "Write content to a file in storage.",
        parameters: z.object({
            path: z.string().optional().describe("Relative path to write to"),
            filename: z.string().optional().describe("Alias for path"),
            content: z.string().optional().describe("Text content to write"),
            text: z.string().optional().describe("Alias for content"),
            body: z.string().optional().describe("Alias for content"),
        }).refine(data => (data.path || data.filename) && (data.content || data.text || data.body), {
            message: "Both path/filename and content/text/body must be provided.",
            path: ["path"]
        }) as any,
        execute: async (args: any, context: ToolContext) => {
            const { path: rawPath, filename, content: rawContent, text, body } = args;
            const path = rawPath || filename;
            const content = rawContent || text || body;

            if (!path || !content) return "Error: Path and content are required.";

            try {
                const orgId = context?.organizationId ?? null;

                // --- Transaction Logging ---
                if (context?.transaction) {
                    await context.transaction.logOperation({
                        type: "file_create",
                        params: { organizationId: orgId, relativePath: path },
                        rollbackData: null // Rollback deletes the file
                    });
                }

                await fileStorageSuccess.saveFile(orgId as any, path, content);
                return `Successfully wrote to ${path}`;
            } catch (e: any) {
                return `Error writing file: ${e.message}`;
            }
        },
    },

    // --- System & Web Tools (Admin/Advanced) ---

    read_system_file: {
        name: "read_system_file",

        idempotency: "read-safe",
        label: "Read System File",
        group: "Files & Storage",
        adminOnly: true,
        description: "Read ANY file on the server's filesystem (Absolute Path). ADMIN ONLY.",
        parameters: z.object({
            path: z.string().describe("Absolute path to the file"),
        }),
        execute: async ({ path }: any, context: ToolContext) => {
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to read system files.";
            }
            return await fileStorageSuccess.unsafeReadAbsolute(path);
        },
    },

    list_system_files: {
        name: "list_system_files",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List System Files",
        group: "Files & Storage",
        adminOnly: true,
        description: "List files in ANY directory on the server's filesystem (Absolute Path). ADMIN ONLY.",
        parameters: z.object({
            path: z.string().describe("Absolute path to the directory"),
        }),
        execute: async ({ path }: any, context: ToolContext) => {
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to list system files.";
            }
            const files = await fileStorageSuccess.unsafeListAbsolute(path);
            return files.join("\n");
        },
    },

    analyze_image: {
        name: "analyze_image",

        idempotency: "read-safe",
        label: "Analyze Image",
        group: "Files & Storage",
        description: "Analyze an image file. Use this when you need to 'see' a diagram, screenshot, or chart. The image data will be attached to your context for the NEXT turn.",
        parameters: z.object({
            filePath: z.string().describe("The path to the image file (relative to sandbox or absolute if admin)"),
        }),
        execute: async ({ filePath }: any, context: ToolContext) => {
            // Check if file exists using storage service logic
            const { FileStorageService } = await import("@domain/knowledge/core/file-storage.js");
            const storage = new FileStorageService();

            // Resolve path logic
            let safePath = "";

            // Admin system check logic (simplified from read_system_file)
            if (filePath.startsWith('/') || filePath.match(/^[a-zA-Z]:/)) {
                // Check admin role if trying to access absolute path
                if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                    return "Error: Access denied. Listing absolute system paths requires Admin role. Only relative sandbox paths allowed.";
                }
                safePath = filePath; // Trust absolute path for admin
            } else {
                // Standard sandbox resolution
                safePath = storage.resolvePath((context.organizationId || 0) as number, filePath);
            }

            try {
                const fs = await import('fs/promises');
                await fs.access(safePath);

                // Return marker for the Agent Runner to intercept
                return `[IMAGE_ATTACHMENT: ${safePath}]`;

            } catch (err: any) {
                return `Error finding image file: ${err.message}`;
            }
        }
    },
    google_doc_read: {
        name: "google_doc_read",

        idempotency: "read-safe",
        label: "Read Google Doc",
        group: "Files & Storage",
        description: "Read the content of a Google Doc. Requires a Google Drive credential.",
        parameters: z.object({
            fileId: z.string().describe("The ID of the Google Doc to read"),
        }),
        execute: async ({ fileId }: any, context: ToolContext) => {
            try {
                const { getGoogleDriveClientForOrg } = await import("@domain/integrations/google-drive-connector-bridge.js");

                const orgId = context?.organizationId ?? null;
                if (orgId == null) {
                    return "Error: No organization context — cannot resolve a Google Drive connection.";
                }

                // Project-scoped connector wins over the org-wide one — same
                // rule the Atlassian bridge applies — then the legacy
                // cloud_storage credential as a fallback.
                const client = await getGoogleDriveClientForOrg(orgId, context?.projectId ?? null);
                if (!client) {
                    return "Error: No Google Drive connection found for this organization. Connect one in the Connectors Dashboard.";
                }

                const result = await client.getFileContent(fileId, 'application/vnd.google-apps.document');
                return result.buffer.toString('utf8');
            } catch (e: any) {
                return `Error reading Google Doc: ${e.message}`;
            }
        },
    },
};
