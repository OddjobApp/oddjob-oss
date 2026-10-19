import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import { fileStorageSuccess } from "@domain/knowledge/core/file-storage.js";
import { queueService } from "@domain/core/infrastructure/queue/queue-service.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

/**
 * Excel column letter for a 0-based index: 0 -> A, 25 -> Z, 26 -> AA.
 * String.fromCharCode(65 + i) only holds to 26 columns; at i=26 it yields "["
 * and produced formulas like SUM([2:[41), which Excel rejects as a corrupt file.
 */
function excelColumnLetter(index: number): string {
    let n = index;
    let out = "";
    while (n >= 0) {
        out = String.fromCharCode(65 + (n % 26)) + out;
        n = Math.floor(n / 26) - 1;
    }
    return out;
}

export interface HeavyJobData {
    type: "pdf" | "excel" | "image" | "word" | "google_doc" | "diagram" | "pptx";
    params: any;
    context: ToolContext;
}

/**
 * Stores generated image bytes as a room attachment and returns the URL the
 * chat surface renders. Attachments are project-scoped by design, so a call
 * with no resolvable room or project returns null rather than writing bytes
 * nothing can read.
 */
async function persistRoomImage(
    context: ToolContext | undefined,
    content: Buffer,
    mimeType: string,
    filePath: string,
): Promise<string | null> {
    const orgId = context?.organizationId;
    const sessionId = context?.sessionId;
    const sessionKey = context?.sessionKey;
    if (orgId == null || sessionId == null || typeof sessionKey !== "string") return null;

    try {
        let projectId = context?.projectId ?? null;
        if (projectId == null) {
            const { projectService } = await import("@domain/projects/core/project.service.js");
            projectId = await projectService.resolveDefaultProjectId(Number(orgId));
        }
        if (projectId == null) return null;

        const { attachmentService } = await import("@domain/knowledge/core/attachment.service.js");
        const { attachment } = await attachmentService.attachToRoom({
            orgId: Number(orgId),
            projectId: Number(projectId),
            sessionId: Number(sessionId),
            buffer: content,
            originalName: filePath.split("/").pop() || "generated-image.png",
            mimeType,
            uploadedBy: context?.agentName ?? context?.userId ?? null,
        });
        return `/api/crew/${encodeURIComponent(sessionKey)}/attachments/${attachment.id}/download`;
    } catch {
        return null;
    }
}

export const heavyLogic = {
    pdf: async ({ path, content, title, themeId, formatCategory, useCreativeCrew, ast }: any, context: ToolContext) => {
        const { chromium } = await import("playwright");
        const { presentationAssemblyService } = await import("@domain/knowledge/core/presentation-assembly.service.js");
        const { presentationCrewService } = await import("@domain/crew/core/presentation-crew.service.js");

        let html: string;

        if (ast && ast.blocks) {
            html = presentationAssemblyService.compileToWebDeck(ast);
        } else if (useCreativeCrew) {
            const crewResult = await presentationCrewService.orchestrateCreativeCrew(content || title || "Document", {
                title: title || "Document Deliverable",
                preferredThemeId: themeId || "clean_minimalist",
                formatCategory: formatCategory || "whitepaper",
            });
            html = presentationAssemblyService.compileToWebDeck(crewResult.ast);
        } else {
            html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 32px; line-height: 1.6; color: #1e293b; }
                        h1 { color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 20px; font-size: 24px; }
                        table { border-collapse: collapse; width: 100%; margin-bottom: 20px; font-size: 14px; }
                        th, td { border: 1px solid #cbd5e1; padding: 10px; text-align: left; }
                        th { background-color: #f1f5f9; font-weight: 600; }
                        p { margin-bottom: 12px; }
                        ul, ol { margin-bottom: 12px; padding-left: 24px; }
                    </style>
                    <title>${title || "Document"}</title>
                </head>
                <body>
                    ${title ? `<h1>${title}</h1>` : ""}
                    ${(content || "").includes('<') ? content : (content || "").split('\n\n').map((p: string) => `<p>${p}</p>`).join('')}
                </body>
                </html>
            `;
        }

        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        // "domcontentloaded" fires before stylesheets and images are fetched. The deck
        // HTML pulls a Google Fonts stylesheet and emits <img> blocks, so that setting
        // printed fallback fonts and blank images. Wait for the network to settle, then
        // for webfonts specifically.
        await page.setContent(html, { waitUntil: "networkidle" });
        await page.evaluate(() => (document as any).fonts?.ready).catch(() => {});
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '1.5cm', right: '1.5cm', bottom: '1.5cm', left: '1.5cm' }
        });
        await browser.close();

        const orgId = context?.organizationId ?? null;
        await fileStorageSuccess.saveFile(orgId, path, pdfBuffer);

        // Record as mission deliverable if mission context is available
        if (context?.missionId) {
            try {
                const { deliverableService } = await import("@domain/mission/core/deliverable.service.js");
                await deliverableService.recordDeliverable({
                    missionId: context.missionId,
                    missionRunId: context.missionRunId,
                    name: title || "Generated PDF Document",
                    content: `PDF document generated at ${path}`,
                    type: 'report',
                    metadata: { fileType: 'pdf', path, generatedBy: 'generate_pdf', formatCategory, themeId }
                });
            } catch (err) {
                // Non-fatal: deliverable recording shouldn't break the generation
                console.warn(`Failed to record deliverable for PDF: ${err}`);
            }
        }

        return `Successfully generated PDF at ${path}`;
    },

    excel: async ({ path, data, sheets, sheetName, themeId, autoFilter, includeSummaryRow }: any, context: ToolContext) => {
        const ExcelJS = await import("exceljs");
        const WorkbookClass = (ExcelJS as any).Workbook || (ExcelJS as any).default?.Workbook || (ExcelJS as any).default;
        const workbook = new WorkbookClass();

        const { PREBUILT_PRESENTATION_THEMES } = await import("@shared/schema/document-block.schema.js");
        const theme = PREBUILT_PRESENTATION_THEMES[themeId || "dark_cyberpunk"] || PREBUILT_PRESENTATION_THEMES["dark_cyberpunk"];
        const cleanHex = (c?: string, fallback = "1E293B") => (c || fallback).replace(/^#/, "").toUpperCase();

        const primaryHex = cleanHex(theme.colors?.primary, "2563EB");
        const surfaceHex = cleanHex(theme.colors?.surface, "0F172A");
        const textLight = "FFFFFF";

        // Normalise sheets input: accept either array of sheets or single data array
        const normalizedSheets: Array<{
            name: string;
            title?: string;
            data: Record<string, any>[];
            autoFilter?: boolean;
            includeSummaryRow?: boolean;
        }> = sheets && Array.isArray(sheets) && sheets.length > 0
            ? sheets
            : [{
                name: sheetName || "Sheet1",
                title: sheetName || undefined,
                data: data || [],
                autoFilter: autoFilter ?? true,
                includeSummaryRow: includeSummaryRow ?? false,
            }];

        let totalRowCount = 0;

        for (const sheetDef of normalizedSheets) {
            const sheet = workbook.addWorksheet(sheetDef.name || "Sheet1");
            const sheetData = sheetDef.data || [];
            totalRowCount += sheetData.length;

            if (sheetData.length === 0) continue;

            const headers = Object.keys(sheetData[0]);

            // Set freeze pane at header row
            const hasTitle = Boolean(sheetDef.title);
            const headerRowNum = hasTitle ? 2 : 1;
            sheet.views = [{ state: 'frozen', ySplit: headerRowNum }];

            let currentRowNum = 1;

            // Optional Title Banner Row
            if (hasTitle) {
                sheet.mergeCells(1, 1, 1, Math.max(headers.length, 1));
                const titleCell = sheet.getCell(1, 1);
                titleCell.value = sheetDef.title;
                titleCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: textLight } };
                titleCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: `FF${surfaceHex}` },
                };
                titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
                sheet.getRow(1).height = 28;
                currentRowNum = 2;
            }

            // Header Row
            const headerRow = sheet.getRow(currentRowNum);
            headers.forEach((h, colIdx) => {
                const cell = headerRow.getCell(colIdx + 1);
                cell.value = h.replace(/[_\-.]+/g, " ").toUpperCase();
                cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: textLight } };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: `FF${primaryHex}` },
                };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FF94A3B8' } },
                    bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
                    left: { style: 'thin', color: { argb: 'FF94A3B8' } },
                    right: { style: 'thin', color: { argb: 'FF94A3B8' } },
                };
            });
            headerRow.height = 24;

            // Data Rows with Zebra Striping
            const dataStartRow = currentRowNum + 1;
            sheetData.forEach((rowObj, rIdx) => {
                const row = sheet.getRow(dataStartRow + rIdx);
                const isEven = rIdx % 2 === 0;
                const rowBg = isEven ? 'FFFFFFFF' : 'FFF8FAFC';

                headers.forEach((h, colIdx) => {
                    const cell = row.getCell(colIdx + 1);
                    const val = rowObj[h];
                    cell.value = val;
                    cell.font = { name: 'Calibri', size: 10 };
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: rowBg },
                    };
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    };

                    if (typeof val === 'number') {
                        cell.alignment = { horizontal: 'right' };
                        cell.numFmt = Number.isInteger(val) ? '#,##0' : '#,##0.00';
                    } else {
                        cell.alignment = { horizontal: 'left' };
                    }
                });
                row.height = 20;
            });

            const dataEndRow = dataStartRow + sheetData.length - 1;

            // Auto-filter
            if (sheetDef.autoFilter ?? autoFilter ?? true) {
                const startColLetter = excelColumnLetter(0);
                const endColLetter = excelColumnLetter(Math.max(headers.length - 1, 0));
                sheet.autoFilter = `${startColLetter}${headerRowNum}:${endColLetter}${dataEndRow}`;
            }

            // Summary / Total Row
            if (sheetDef.includeSummaryRow ?? includeSummaryRow) {
                const summaryRow = sheet.getRow(dataEndRow + 1);
                headers.forEach((h, colIdx) => {
                    const colLetter = excelColumnLetter(colIdx);
                    const cell = summaryRow.getCell(colIdx + 1);
                    const sampleVal = sheetData[0]?.[h];

                    if (typeof sampleVal === 'number') {
                        cell.value = { formula: `SUM(${colLetter}${dataStartRow}:${colLetter}${dataEndRow})` } as any;
                        cell.numFmt = Number.isInteger(sampleVal) ? '#,##0' : '#,##0.00';
                        cell.alignment = { horizontal: 'right' };
                    } else if (colIdx === 0) {
                        cell.value = "TOTAL";
                        cell.alignment = { horizontal: 'left' };
                    }

                    cell.font = { name: 'Calibri', size: 11, bold: true };
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFF1F5F9' },
                    };
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'FF0F172A' } },
                        bottom: { style: 'double', color: { argb: 'FF0F172A' } },
                    };
                });
                summaryRow.height = 22;
            }

            // Auto-fit Column Widths
            headers.forEach((h, colIdx) => {
                let maxLen = h.length;
                sheetData.forEach(row => {
                    const v = row[h];
                    if (v !== undefined && v !== null) {
                        maxLen = Math.max(maxLen, String(v).length);
                    }
                });
                sheet.getColumn(colIdx + 1).width = Math.max(maxLen + 4, 12);
            });
        }

        const buffer = await workbook.xlsx.writeBuffer();
        const orgId = context?.organizationId ?? null;
        await fileStorageSuccess.saveFile(orgId, path, Buffer.from(buffer));

        if (context?.missionId) {
            try {
                const { deliverableService } = await import("@domain/mission/core/deliverable.service.js");
                await deliverableService.recordDeliverable({
                    missionId: context.missionId,
                    missionRunId: context.missionRunId,
                    name: sheetName || "Generated Excel Spreadsheet",
                    content: `Excel spreadsheet generated at ${path} with ${totalRowCount} rows across ${normalizedSheets.length} sheet(s)`,
                    type: 'dataset',
                    metadata: { fileType: 'excel', path, rowCount: totalRowCount, sheetCount: normalizedSheets.length, generatedBy: 'generate_excel' }
                });
            } catch (err) {
                console.warn(`Failed to record deliverable for Excel: ${err}`);
            }
        }

        return `Successfully generated styled Excel file at ${path} (${totalRowCount} rows, ${normalizedSheets.length} sheet(s))`;
    },

    image: async ({ path, prompt, title, aspectRatio }: any, context: ToolContext) => {
        const orgId = context?.organizationId ?? null;

        // Gemini first, on the organization's own key -- never the platform's in
        // production, where the org is the one billed. An org without a Gemini
        // key falls through to its own DALL-E credential below, if it has one.
        const { resolveOrgGeminiKey, ORG_GEMINI_KEY_MISSING } = await import("@domain/ai/core/org-gemini-key.js");
        const geminiKey = await resolveOrgGeminiKey(orgId);
        if (geminiKey) {
            const { createGeminiImageGenerator, GEMINI_IMAGE_ASPECT_RATIOS } =
                await import("@domain/media-studio/core/gemini-image.js");
            const ratio = aspectRatio && aspectRatio in GEMINI_IMAGE_ASPECT_RATIOS
                ? aspectRatio
                : "1:1";
            const image = await createGeminiImageGenerator({ apiKey: geminiKey }).generate(prompt, ratio);

            await fileStorageSuccess.saveFile(orgId, path, image.content).catch(() => {/* non-fatal */});
            // A room attachment is the only served URL these bytes can get —
            // fileStorage has no route, and a data URI would land the whole
            // base64 blob in the tool result the model reads back.
            const url = await persistRoomImage(context, image.content, image.mimeType, path);

            if (context?.missionId) {
                try {
                    const { deliverableService } = await import("@domain/mission/core/deliverable.service.js");
                    await deliverableService.recordDeliverable({
                        missionId: context.missionId,
                        missionRunId: context.missionRunId,
                        name: title || "Generated Image",
                        content: `Image generated from prompt: "${prompt}". Saved at ${path}`,
                        type: 'media',
                        metadata: { fileType: 'image', path, url, prompt, model: image.model, generatedBy: 'generate_image' }
                    });
                } catch (err) {
                    console.warn(`Failed to record deliverable for image: ${err}`);
                }
            }

            if (!url) {
                return `Successfully generated image at ${path} (Gemini ${image.model}), but it could not be attached to a project space for inline display.`;
            }
            return JSON.stringify({
                type: "assistant_image",
                url,
                path,
                title: title || "Generated Image",
                description: prompt,
            });
        }

        const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");
        const { credentialsService } = await import("@domain/auth/core/credentials-service.js");

        const credentials = await credentialsService.list(orgId as any);
        const dalleCred = credentials.find(c =>
            c.type === 'api_key' &&
            (c.name.toLowerCase().includes('openai') || c.name.toLowerCase().includes('dalle'))
        );

        if (!dalleCred) throw new Error(`${ORG_GEMINI_KEY_MISSING} to generate images (or add an OpenAI/DALL-E credential).`);

        const apiKey = (await resolveCredentialSecret(dalleCred));
        if (!apiKey) throw new Error("API Key for DALL-E is missing");

        const client = AIClientFactory.getClient({ provider: "openai_dalle" } as any);
        const result = await client.execute({
            model: "dall-e-3",
            userPrompt: prompt,
            requestType: "text",
        } as any, undefined, apiKey);

        if (!result.success || !result.output) throw new Error(result.error || "Image generation failed");

        // Save to storage in background — don't block the inline response
        const imgResponse = await fetch(result.output);
        if (imgResponse.ok) {
            const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
            await fileStorageSuccess.saveFile(orgId, path, imgBuffer).catch(() => {/* non-fatal */});
        }

        // Record as mission deliverable if mission context is available
        if (context?.missionId) {
            try {
                const { deliverableService } = await import("@domain/mission/core/deliverable.service.js");
                await deliverableService.recordDeliverable({
                    missionId: context.missionId,
                    missionRunId: context.missionRunId,
                    name: title || "Generated Image",
                    content: `Image generated from prompt: "${prompt}". Saved at ${path}`,
                    type: 'media',
                    metadata: { fileType: 'image', path, url: result.output, prompt, generatedBy: 'generate_image' }
                });
            } catch (err) {
                console.warn(`Failed to record deliverable for image: ${err}`);
            }
        }

        // Return an assistant_image payload so the CREW room renders it inline immediately
        return JSON.stringify({
            type: "assistant_image",
            url: result.output,          // DALL-E CDN URL — valid ~1 hour
            path,                        // stored path for downstream reference
            title: title || "Generated Image",
            description: prompt,
        });
    },

    word: async ({ path, content, title, themeId, formatCategory, useCreativeCrew, ast }: any, context: ToolContext) => {
        const { presentationAssemblyService } = await import("@domain/knowledge/core/presentation-assembly.service.js");
        const { presentationCrewService } = await import("@domain/crew/core/presentation-crew.service.js");

        let buffer: Buffer;

        if (ast && ast.blocks) {
            buffer = await presentationAssemblyService.compileASTToDocx(ast);
        } else if (useCreativeCrew) {
            const crewResult = await presentationCrewService.orchestrateCreativeCrew(content || title || "Document", {
                title: title || "Document Deliverable",
                preferredThemeId: themeId || "clean_minimalist",
                formatCategory: formatCategory || "whitepaper",
            });
            buffer = await presentationAssemblyService.compileASTToDocx(crewResult.ast);
        } else {
            const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
            const children = [];
            if (title) {
                children.push(new Paragraph({
                    text: title,
                    heading: HeadingLevel.HEADING_1,
                    spacing: { after: 180 },
                }));
            }

            const paragraphs = (content || "").split('\n\n');
            for (const p of paragraphs) {
                if (p.trim()) {
                    children.push(new Paragraph({
                        children: [new TextRun(p.trim())],
                        spacing: { after: 120 },
                    }));
                }
            }

            const doc = new Document({
                sections: [{
                    properties: {},
                    children: children,
                }],
            });

            buffer = await Packer.toBuffer(doc);
        }

        const orgId = context?.organizationId ?? null;
        await fileStorageSuccess.saveFile(orgId, path, buffer);

        // Record as mission deliverable if mission context is available
        if (context?.missionId) {
            try {
                const { deliverableService } = await import("@domain/mission/core/deliverable.service.js");
                await deliverableService.recordDeliverable({
                    missionId: context.missionId,
                    missionRunId: context.missionRunId,
                    name: title || "Generated Word Document",
                    content: `Word document generated at ${path}`,
                    type: 'report',
                    metadata: { fileType: 'word', path, generatedBy: 'generate_word', formatCategory, themeId }
                });
            } catch (err) {
                console.warn(`Failed to record deliverable for Word: ${err}`);
            }
        }

        return `Successfully generated Word document at ${path}`;
    },

    google_doc: async ({ title, content }: any, context: ToolContext) => {
        const { getGoogleDriveClientForOrg } = await import("@domain/integrations/google-drive-connector-bridge.js");

        const orgId = context?.organizationId ?? null;
        if (orgId == null) throw new Error("No organization context — cannot resolve a Google Drive connection");

        // Writable scope: the read-only client would 403 on files.create.
        // Project-scoped connector wins over the org-wide row, matching the
        // Atlassian bridge's scoping rule.
        const client = await getGoogleDriveClientForOrg(orgId, context?.projectId ?? null, { writable: true });
        if (!client) {
            throw new Error("No Google Drive connection found for this organization. Connect one in the Connectors Dashboard.");
        }

        const result = await client.createFile(title, content, 'application/vnd.google-apps.document');
        const docUrl = result.webViewLink ?? `https://docs.google.com/document/d/${result.id}/edit`;

        // Record as mission deliverable if mission context is available
        if (context?.missionId) {
            try {
                const { deliverableService } = await import("@domain/mission/core/deliverable.service.js");
                await deliverableService.recordDeliverable({
                    missionId: context.missionId,
                    missionRunId: context.missionRunId,
                    name: title || "Generated Google Doc",
                    content: `Google Doc created: ${result.name} — ${docUrl}`,
                    type: 'report',
                    metadata: { fileType: 'google_doc', docId: result.id, url: docUrl, generatedBy: 'generate_google_doc' }
                });
            } catch (err) {
                console.warn(`Failed to record deliverable for Google Doc: ${err}`);
            }
        }

        return `Successfully created Google Doc: ${result.name} — ${docUrl} (ID: ${result.id})`;
    },

    diagram: async ({ path, code, title }: any, context: ToolContext) => {
        // Simple validation: check if it starts with valid mermaid keywords
        const keywords = ['graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'erDiagram', 'journey', 'gantt', 'pie', 'quadrantChart', 'requirementDiagram', 'mindmap', 'timeline'];
        const trimmedCode = code.trim();
        const firstWord = trimmedCode.split(/\s+/)[0];

        if (!keywords.includes(firstWord)) {
            // If it doesn't start with a keyword, it might be inside a code block or missing one
            if (!trimmedCode.startsWith('graph TD') && !trimmedCode.startsWith('flowchart')) {
                // Default to flowchart if unsure
                code = `flowchart TD\n${code}`;
            }
        }

        const orgId = context?.organizationId ?? null;
        await fileStorageSuccess.saveFile(orgId, path, Buffer.from(code));

        // Record as mission deliverable if mission context is available
        if (context?.missionId) {
            try {
                const { deliverableService } = await import("@domain/mission/core/deliverable.service.js");
                await deliverableService.recordDeliverable({
                    missionId: context.missionId,
                    missionRunId: context.missionRunId,
                    name: title || "Generated Mermaid Diagram",
                    content: `Mermaid diagram generated at ${path}`,
                    type: 'report',
                    metadata: { fileType: 'mermaid', path, generatedBy: 'generate_mermaid_diagram' }
                });
            } catch (err) {
                console.warn(`Failed to record deliverable for Mermaid diagram: ${err}`);
            }
        }

        return `Successfully generated Mermaid diagram at ${path}. Content:\n\n\`\`\`mermaid\n${code}\n\`\`\``;
    },

    pptx: async ({ path, content, title, themeId, formatCategory, ast }: any, context: ToolContext) => {
        const { presentationAssemblyService } = await import("@domain/knowledge/core/presentation-assembly.service.js");
        const { presentationCrewService } = await import("@domain/crew/core/presentation-crew.service.js");

        let buffer: Buffer;

        if (ast && ast.blocks) {
            buffer = await presentationAssemblyService.compileASTToPptx(ast);
        } else {
            const crewResult = await presentationCrewService.orchestrateCreativeCrew(content || title || "Presentation Deck", {
                title: title || "Presentation Deliverable",
                preferredThemeId: themeId || "dark_cyberpunk",
                formatCategory: formatCategory || "presentation_deck",
            });
            buffer = await presentationAssemblyService.compileASTToPptx(crewResult.ast);
        }

        const orgId = context?.organizationId ?? null;
        await fileStorageSuccess.saveFile(orgId, path, buffer);

        if (context?.missionId) {
            try {
                const { deliverableService } = await import("@domain/mission/core/deliverable.service.js");
                await deliverableService.recordDeliverable({
                    missionId: context.missionId,
                    missionRunId: context.missionRunId,
                    name: title || "Generated PowerPoint Presentation",
                    content: `PowerPoint (.pptx) presentation generated at ${path}`,
                    type: 'report',
                    metadata: { fileType: 'pptx', path, generatedBy: 'generate_powerpoint', formatCategory, themeId }
                });
            } catch (err) {
                console.warn(`Failed to record deliverable for PPTX: ${err}`);
            }
        }

        return `Successfully generated PowerPoint presentation (.pptx) at ${path}`;
    }
};

async function runHeavyTask(type: HeavyJobData["type"], params: any, context: ToolContext) {
    const job = await queueService.heavyQueue.add(`${type}-generation`, {
        type,
        params,
        context
    });
    return await queueService.waitForJob(queueService.heavyEvents, job);
}

/**
 * Every tool below RETHROWS on failure rather than returning the error as its
 * output.
 *
 * They used to `return \`Error generating X: …\``, which is a normal successful
 * return value as far as a caller is concerned. tool-executor.service.ts got
 * away with it by sniffing outputs that start with "error", but the CREW room
 * executor has no such heuristic: it recorded `ok: true` and handed the string
 * to the model as a result, so a browser crash inside generate_pdf reached the
 * user as a document that had supposedly been created. Throwing is what both
 * executors already treat as failure.
 */
export const GENERATION_TOOLS: Record<string, ToolDefinition> = {
    generate_pdf: {
        name: "generate_pdf",
        label: "Generate PDF",
        group: "Generation",
        description: "Generate a polished PDF file from Markdown, HTML, or Creative Crew Document AST and save it to storage.",
        riskLevel: "low",
        idempotency: "read-safe",
        sideEffects: ["file-system"],
        parameters: z.object({
            path: z.string().describe("Relative path to save the PDF (e.g., 'reports/today.pdf')"),
            content: z.string().describe("Markdown or HTML content to render in the PDF"),
            title: z.string().optional().describe("Title for the document"),
            themeId: z.enum(["dark_cyberpunk", "glass_corporate", "editorial_magazine", "vibrant_product", "clean_minimalist"]).optional().describe("Optional theme ID"),
            formatCategory: z.enum(["presentation_deck", "magazine_ad", "whitepaper", "executive_brief"]).optional().describe("Output document format category"),
            useCreativeCrew: z.boolean().optional().describe("Whether to run the Creative Crew pipeline to distill into styled document blocks"),
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                return await runHeavyTask("pdf", params, context);
            } catch (e: any) {
                throw new Error(`Error generating PDF: ${e.message}`);
            }
        },
    },

    generate_excel: {
        name: "generate_excel",
        label: "Generate Excel",
        group: "Generation",
        description: "Generate an Excel (.xlsx) file from structured data (JSON) and save it to storage.",
        riskLevel: "low",
        idempotency: "read-safe",
        sideEffects: ["file-system"],
        parameters: z.object({
            path: z.string().describe("Relative path to save the Excel file (e.g., 'reports/data.xlsx')"),
            data: z.array(z.record(z.any())).optional().describe("Array of objects representing rows (for single-sheet workbooks)"),
            sheets: z.array(z.object({
                name: z.string().describe("Worksheet tab name"),
                title: z.string().optional().describe("Optional banner title for the sheet"),
                data: z.array(z.record(z.any())).describe("Array of row objects"),
                autoFilter: z.boolean().optional().describe("Whether to enable auto-filter dropdowns"),
                includeSummaryRow: z.boolean().optional().describe("Whether to append automated SUM total formulas for numeric columns"),
            })).optional().describe("Array of worksheet configurations for multi-sheet workbooks"),
            sheetName: z.string().optional().default("Sheet1").describe("Name of the default worksheet when data is used"),
            themeId: z.enum(["dark_cyberpunk", "glass_corporate", "editorial_magazine", "vibrant_product", "clean_minimalist"]).optional().describe("Theme palette for header fills and borders"),
            autoFilter: z.boolean().optional().default(true).describe("Whether to enable header auto-filters"),
            includeSummaryRow: z.boolean().optional().default(false).describe("Whether to append automated summary formula rows"),
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                return await runHeavyTask("excel", params, context);
            } catch (e: any) {
                throw new Error(`Error generating Excel: ${e.message}`);
            }
        },
    },

    generate_image: {
        name: "generate_image",
        label: "Generate Image",
        group: "Generation",
        description:
            "Generate an image from a text prompt and render it inline in the assistant chat. " +
            "The generated image appears immediately as a visual artifact in the chat turn. " +
            "Also saves a copy to file storage for future reference. " +
            "Always use this instead of describing what an image would look like — generate and show it.",
        riskLevel: "low",
        idempotency: "read-safe",
        sideEffects: ["file-system", "external-api"],
        parameters: z.object({
            path: z.string().describe("Relative path to save the image (e.g., 'assets/image.png')"),
            prompt: z.string().describe("Detailed description of the image to generate. Be specific about style, composition, colors."),
            title: z.string().optional().describe("Optional title shown above the rendered image in the chat."),
            aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "2.39:1"]).optional()
                .describe("Output aspect ratio; defaults to 1:1"),
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                return await runHeavyTask("image", params, context);
            } catch (e: any) {
                throw new Error(`Error generating image: ${e.message}`);
            }
        },
    },

    generate_word: {
        name: "generate_word",
        label: "Generate Word",
        group: "Generation",
        description: "Generate a styled Word (.docx) document from text, Markdown, or Creative Crew Document AST and save it to storage.",
        riskLevel: "low",
        idempotency: "read-safe",
        sideEffects: ["file-system"],
        parameters: z.object({
            path: z.string().describe("Relative path to save the Word file (e.g., 'reports/doc.docx')"),
            content: z.string().describe("The content of the document. Supports Markdown or plain text."),
            title: z.string().optional().describe("Title for the document"),
            themeId: z.enum(["dark_cyberpunk", "glass_corporate", "editorial_magazine", "vibrant_product", "clean_minimalist"]).optional().describe("Optional theme ID"),
            formatCategory: z.enum(["presentation_deck", "magazine_ad", "whitepaper", "executive_brief"]).optional().describe("Output document format category"),
            useCreativeCrew: z.boolean().optional().describe("Whether to run the Creative Crew pipeline to distill into styled document blocks"),
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                return await runHeavyTask("word", params, context);
            } catch (e: any) {
                throw new Error(`Error generating Word document: ${e.message}`);
            }
        },
    },

    generate_google_doc: {
        name: "generate_google_doc",
        label: "Create Google Doc",
        group: "Generation",
        description: "Create a new Google Doc from content. Requires a Google Drive connection.",
        riskLevel: "low",
        // Every call creates a new remote document — not safe to replay.
        idempotency: "none",
        sideEffects: ["external-api"],
        parameters: z.object({
            title: z.string().describe("Title of the Google Doc"),
            content: z.string().describe("Text content for the document"),
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                return await runHeavyTask("google_doc", params, context);
            } catch (e: any) {
                throw new Error(`Error creating Google Doc: ${e.message}`);
            }
        },
    },

    generate_mermaid_diagram: {
        name: "generate_mermaid_diagram",
        label: "Generate Diagram",
        group: "Generation",
        description: "Generate a Mermaid.js diagram (Flowchart, Sequence, ERD, etc.) and save it to storage.",
        riskLevel: "low",
        idempotency: "read-safe",
        sideEffects: ["file-system"],
        parameters: z.object({
            path: z.string().describe("Relative path to save the diagram (e.g., 'diagrams/workflow.mermaid')"),
            code: z.string().describe("The Mermaid.js code for the diagram"),
            title: z.string().optional().describe("Title for the diagram"),
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                return await runHeavyTask("diagram", params, context);
            } catch (e: any) {
                throw new Error(`Error generating diagram: ${e.message}`);
            }
        },
    },

    ai_translate: {
        name: "ai_translate",
        label: "AI Translate",
        group: "Generation",
        description: "Translate text from one language to another using AI. Preserves formatting and tone.",
        riskLevel: "low",
        idempotency: "read-safe",
        sideEffects: [],
        parameters: z.object({
            text: z.string().describe("The text to translate"),
            targetLanguage: z.string().describe("The language to translate into (e.g. 'German', 'Japanese', 'Spanish')"),
            sourceLanguage: z.string().optional().describe("The source language (optional, will be auto-detected)"),
        }),
        execute: async ({ text, targetLanguage, sourceLanguage }: any, context: ToolContext) => {
            try {
                const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");
                const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");

                const aiConfig = await systemAiService.getAiConfig('copilot', context?.organizationId as any);
                if (!aiConfig || !aiConfig.apiKey) throw new Error("AI configuration missing");

                const client = AIClientFactory.getClient({ provider: aiConfig.provider } as any);
                const prompt = `Translate the following text into ${targetLanguage}${sourceLanguage ? ` from ${sourceLanguage}` : ''}. 
                Maintain the original tone, formatting, and technical terms where appropriate. 
                Output ONLY the translated text.

                TEXT TO TRANSLATE:
                ${text}`;

                const result = await client.execute({
                    model: aiConfig.model || "gemini-1.5-flash",
                    systemPrompt: "You are a professional translator.",
                    userPrompt: prompt,
                    temperature: 0.3,
                } as any, undefined, aiConfig.apiKey);

                if (!result.success || !result.output) throw new Error(result.error || "Translation failed");

                return result.output;
            } catch (e: any) {
                throw new Error(`Translation error: ${e.message}`);
            }
        },
    },

    generate_presentation_deck: {
        name: "generate_presentation_deck",
        label: "Generate Presentation Deck",
        group: "Generation",
        description: "Assembles visual presentation deliverables (slide decks, magazine ads, documents, executive briefs) using 4-agent creative crew and atomic block layout engine.",
        riskLevel: "low",
        idempotency: "read-safe",
        sideEffects: [],
        parameters: z.object({
            title: z.string().describe("Title of the presentation deliverable"),
            content: z.string().describe("Raw markdown or structured text content to distill into presentation blocks"),
            themeId: z.enum(["dark_cyberpunk", "glass_corporate", "editorial_magazine", "vibrant_product", "clean_minimalist"]).default("dark_cyberpunk").describe("Design system theme ID"),
            formatCategory: z.enum(["presentation_deck", "magazine_ad", "whitepaper", "executive_brief"]).default("presentation_deck").describe("Output document format category"),
            sourceQuery: z.object({
                id: z.number().nullable().optional(),
                name: z.string(),
            }).optional().describe("Saved query that supplied this document's data. Pass this when content came from run_saved_query so its lineage appears in the Assembly Stack."),
        }),
        execute: async ({ title, content, themeId, formatCategory, sourceQuery }: any, context: ToolContext) => {
            try {
                const { presentationCrewService } = await import("../../../crew/core/presentation-crew.service.js");
                const result = await presentationCrewService.orchestrateCreativeCrew(content, {
                    title,
                    preferredThemeId: themeId,
                    formatCategory,
                });

                // Auto-record mission deliverable if executing in mission context
                if (context?.missionId) {
                    try {
                        const { deliverableService } = await import("@domain/mission/core/deliverable.service.js");
                        await deliverableService.recordDeliverable({
                            missionId: Number(context.missionId),
                            missionRunId: context.missionRunId ? Number(context.missionRunId) : undefined,
                            name: title || `${formatCategory} deliverable`,
                            content: JSON.stringify(result.ast),
                            type: 'report',
                            metadata: {
                                formatCategory,
                                themeId,
                                requiresHilSignoff: result.requiresHilSignoff,
                                executionPhases: result.executionPhases,
                            },
                        });
                    } catch (delivErr) {
                        console.warn("[generate_presentation_deck] Deliverable recording note:", delivErr);
                    }
                }

                return JSON.stringify({
                    type: "presentation_deck",
                    title,
                    formatCategory,
                    theme: result.ast.designSystem.name,
                    blockCount: result.ast.blocks.length,
                    blocks: result.ast.blocks,
                    ast: result.ast,
                    requiresHilSignoff: result.requiresHilSignoff,
                    executionPhases: result.executionPhases,
                    ...(sourceQuery ? {
                        lineage: {
                            source: { type: "saved_query", id: sourceQuery.id ?? null, name: sourceQuery.name },
                            output: { type: "document", formatCategory },
                        },
                    } : {}),
                    summary: `Generated ${formatCategory} "${title}" with ${result.ast.blocks.length} structured blocks.`,
                });
            } catch (e: any) {
                throw new Error(`Error generating presentation deck: ${e.message}`);
            }
        },
    },

    generate_powerpoint: {
        name: "generate_powerpoint",
        label: "Generate PowerPoint (.pptx)",
        group: "Generation",
        description: "Generate a native, editable Microsoft PowerPoint presentation (.pptx) matching design system themes and block layouts.",
        riskLevel: "low",
        idempotency: "read-safe",
        sideEffects: ["file-system"],
        parameters: z.object({
            path: z.string().describe("Relative path to save the PPTX file (e.g., 'decks/presentation.pptx')"),
            content: z.string().describe("Text or markdown content to structure into slides"),
            title: z.string().optional().describe("Title for the presentation"),
            themeId: z.enum(["dark_cyberpunk", "glass_corporate", "editorial_magazine", "vibrant_product", "clean_minimalist"]).optional().default("dark_cyberpunk").describe("Design system theme ID"),
            formatCategory: z.enum(["presentation_deck", "magazine_ad", "whitepaper", "executive_brief"]).optional().default("presentation_deck").describe("Output document format category"),
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                return await runHeavyTask("pptx", params, context);
            } catch (e: any) {
                throw new Error(`Error generating PowerPoint presentation: ${e.message}`);
            }
        },
    },

    update_document_ast: {
        name: "update_document_ast",
        label: "Update Document AST",
        group: "Generation",
        description: "Applies conversational in-place mutations (modify block, add block, remove block, reorder blocks, change theme) to an existing Document AST.",
        riskLevel: "low",
        idempotency: "read-safe",
        sideEffects: [],
        parameters: z.object({
            ast: z.record(z.any()).describe("The current DocumentBlockAST to mutate"),
            operation: z.discriminatedUnion("action", [
                z.object({
                    action: z.literal("modify_block"),
                    blockId: z.string().describe("ID of the block to modify"),
                    updatedBlock: z.record(z.any()).describe("Updated block fields"),
                }),
                z.object({
                    action: z.literal("add_block"),
                    block: z.record(z.any()).describe("New DocumentBlock object to insert"),
                    targetIndex: z.number().optional().describe("Index to insert the block at"),
                }),
                z.object({
                    action: z.literal("remove_block"),
                    blockId: z.string().describe("ID of the block to delete"),
                }),
                z.object({
                    action: z.literal("change_theme"),
                    themeId: z.enum(["dark_cyberpunk", "glass_corporate", "editorial_magazine", "vibrant_product", "clean_minimalist"]).describe("Target design system theme ID"),
                }),
                z.object({
                    action: z.literal("reorder_blocks"),
                    fromIndex: z.number().describe("Source index"),
                    toIndex: z.number().describe("Destination index"),
                }),
            ]),
        }),
        execute: async ({ ast, operation }: any, context: ToolContext) => {
            try {
                const { presentationAssemblyService, auditThemeContrast } = await import("@domain/knowledge/core/presentation-assembly.service.js");
                const mutatedAst = presentationAssemblyService.mutateBlockAST(ast, operation);

                const contrast = auditThemeContrast(mutatedAst.designSystem);
                const contrastSummary = contrast.every((c: any) => c.passesAA)
                    ? "WCAG AA contrast verified"
                    : "Some color contrast thresholds flagged";

                return JSON.stringify({
                    type: "presentation_deck",
                    title: mutatedAst.title,
                    formatCategory: mutatedAst.formatCategory,
                    theme: mutatedAst.designSystem.name,
                    blockCount: mutatedAst.blocks.length,
                    blocks: mutatedAst.blocks,
                    ast: mutatedAst,
                    summary: `Updated Document AST via "${operation.action}" (${contrastSummary}).`,
                });
            } catch (e: any) {
                throw new Error(`Error updating document AST: ${e.message}`);
            }
        },
    },
};
