import type { AIApiCallConfig } from "@shared/schema/index.js";
import { PDFParse } from 'pdf-parse';
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("RagUtils");

export interface RagContextResult {

  context: string;
  length: number;
}

export interface RagAssetSummary {
  id: number;
  name: string;
  assetType: string;
  sourceType: string;
  order: number;
}

export interface RagContentSource {
  id: number;
  name: string;
  assetType: string;
  sourceType: string;
  order?: number | null;
  textContent?: string | null;
  fileData?: string | null;
  contentType?: string | null;
  fileSize?: number | null;
  url?: string | null;
  qdrantPointId?: string | null;
  // Universal Indexing Extensions
  datasetId?: number | null;
  nodeId?: number | null;
  metadata?: Record<string, any> | null;
}

export async function getAssetPlainText(asset: RagContentSource): Promise<string> {
  if (asset.textContent?.trim()) {
    // Universal Text Formatting
    if (asset.sourceType === 'dataset_row' || asset.sourceType === 'graph_node') {
      try {
        const data = JSON.parse(asset.textContent);

        // If it's a dataset row, we might want to flatten it to "Key: Value"
        if (typeof data === 'object' && data !== null) {
          const parts = [];
          if (asset.sourceType === 'dataset_row') parts.push(`Dataset Record: ${asset.name}`);
          if (asset.sourceType === 'graph_node') parts.push(`Entity Knowledge Node: ${asset.name} (${data.label || 'Node'})`);

          for (const [key, value] of Object.entries(data)) {
            if (key === 'id' || key === 'label' || value === null || value === undefined) continue;
            // Recursively stringify objects if needed, or just simple string conversion
            const valStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
            parts.push(`${key}: ${valStr}`);
          }
          return parts.join('\n');
        }
      } catch (e) {
        // Fallback to raw text if parsing fails
        return asset.textContent.trim();
      }
    }
    return asset.textContent.trim();
  }

  if (asset.fileData) {
    try {
      if (
        asset.contentType?.startsWith("text/") ||
        asset.contentType === "application/json" ||
        asset.name.endsWith(".txt") ||
        asset.name.endsWith(".md") ||
        asset.name.endsWith(".json")
      ) {
        const buffer = Buffer.from(asset.fileData, "base64");
        return buffer.toString("utf-8");
      }

      if (
        asset.contentType === "application/pdf" ||
        asset.name.toLowerCase().endsWith(".pdf")
      ) {
        const buffer = Buffer.from(asset.fileData, "base64");
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        console.log(`[RAG] Extracted ${result.text.length} characters from PDF: ${asset.name}`);
        return result.text;
      }

      return `File: ${asset.name}\n[Binary content - not supported for direct extraction]`;
    } catch (error: any) {
      console.error(`Error processing file ${asset.name}:`, error);
      throw error;
    }
  }

  if (asset.url) {
    try {
      console.log(`Fetching content from URL: ${asset.url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(asset.url, {
        headers: { "User-Agent": "Oddjob-RAG-Bot/1.0" },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || "";

      let body: string;
      if (contentType.includes("application/json")) {
        const json = await response.json();
        body = JSON.stringify(json, null, 2);
      } else if (contentType.includes("text/html")) {
        const html = await response.text();
        body = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      } else if (contentType.includes("text/") || contentType.includes("application/xml")) {
        body = await response.text();
      } else {
        body = await response.text();
      }

      const maxLength = 50 * 1024;
      if (body.length > maxLength) {
        body =
          body.substring(0, maxLength) +
          `\n\n[Content truncated - original length: ${body.length} characters]`;
      }

      console.log(`Successfully fetched ${body.length} characters from ${asset.url}`);
      return body;
    } catch (error) {
      console.error(`Error fetching URL ${asset.url}:`, error);
      return `External resource: ${asset.url}\n[Error fetching content: ${error instanceof Error ? error.message : "Unknown error"}]`;
    }
  }

  return "[No content provided]";
}

export const buildRagContextString = async (
  assets: RagContentSource[],
): Promise<RagContextResult> => {
  if (!assets.length) {
    return { context: "", length: 0 };
  }
  
  // We dynamically import to avoid circular dependencies if any
  const { OKFSerializer } = await import('./okf-serializer.js');

  const sections = await Promise.all(
    assets.map(async (asset) => {
      const body = await getAssetPlainText(asset);
      const docContext = OKFSerializer.serialize({
          title: asset.name,
          metadata: {
              type: asset.assetType,
              sourceType: asset.sourceType,
              ...(asset.metadata || {})
          },
          url: asset.url || undefined,
          textContent: body,
      });
      return `[The following OKF formatted knowledge is provided in this message]\n\n${docContext}`;
    })
  );

  const context = sections.join("\n\n");
  return {
    context,
    length: context.length,
  };
};

export const augmentPromptWithRag = (
  config: AIApiCallConfig,
  ragContext: string
): AIApiCallConfig => {
  if (!ragContext.trim()) {
    return config;
  }

  const combinedPrompt = `${config.userPrompt}\n\n---\n\nIMPORTANT: The following text is already included in this message. It is NOT a file attachment or external resource. The content is provided directly below. Please read and use this information to answer the question above:\n\n${ragContext}`.trim();

  const systemPrompt = config.systemPrompt
    ? `${config.systemPrompt}\n\nNote: When the user provides context information in their message, it is already included in the message text. You should use that information directly - do not ask the user to paste or attach files.`
    : `When the user provides context information in their message, it is already included in the message text. You should use that information directly - do not ask the user to paste or attach files.`;

  console.log('[RAG Augmentation] Combined prompt length:', combinedPrompt.length);

  return {
    ...config,
    userPrompt: combinedPrompt,
    systemPrompt: systemPrompt,
  };
};

export const summarizeRagAssets = (assets: RagContentSource[]): RagAssetSummary[] =>
  assets.map(({ id, name, assetType, sourceType, order }) => ({
    id,
    name,
    assetType,
    sourceType,
    order: order ?? 0,
  }));


