/**
 * Gemini Files API Helper
 * 
 * Handles uploading files to Google Gemini's Files API for use with File Search Tool
 */

import type { RagContentSource } from "../../knowledge/core/rag-utils.service.js";
import type { GeminiFileAttachment } from "./ai-client.service.js";

export interface GeminiFileUploadResult extends GeminiFileAttachment {}

const GEMINI_FILE_MODEL_KEYWORDS = [
  "models/gemini-1.5",
  "gemini-1.5",
  "models/gemini-2.0",
  "gemini-2.0",
  "models/gemini-2.5",
  "gemini-2.5",
];

export function supportsGeminiFileAttachments(model?: string | null): boolean {
  if (!model) return false;
  const normalized = model.toLowerCase();
  return GEMINI_FILE_MODEL_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

/**
 * Upload a RAG asset file to Gemini's Files API
 * @param asset The RAG asset to upload
 * @param apiKey Google API key
 * @returns File URI that can be used in Gemini API requests
 */
export async function uploadFileToGemini(
  asset: RagContentSource,
  apiKey: string
): Promise<GeminiFileUploadResult> {
  try {
    let fileContent: Buffer;
    let mimeType: string;
    let fileName: string = asset.name;

    // Prepare file content based on asset type
    if (asset.fileData) {
      // Decode base64 file data
      fileContent = Buffer.from(asset.fileData, 'base64');
      mimeType = asset.contentType || 'application/octet-stream';
    } else if (asset.textContent) {
      // Convert text content to buffer
      fileContent = Buffer.from(asset.textContent, 'utf-8');
      mimeType = 'text/plain';
      fileName = `${asset.name}.txt`;
    } else if (asset.url) {
      // Fetch content from URL
      const response = await fetch(asset.url, {
        headers: {
          'User-Agent': 'Oddjob-RAG-Bot/1.0',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
      }
      
      const contentType = response.headers.get('content-type') || 'text/plain';
      fileContent = Buffer.from(await response.arrayBuffer());
      mimeType = contentType;
      
      // Try to get filename from URL or Content-Disposition header
      const contentDisposition = response.headers.get('content-disposition');
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
        if (filenameMatch) {
          fileName = filenameMatch[1];
        }
      }
    } else {
      throw new Error(`Asset ${asset.id} has no fileData, textContent, or url`);
    }

    // Upload to Gemini Files API
    const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files`;
    
    let formData: FormData | Buffer;
    let contentType: string;
    
    if (typeof FormData !== 'undefined' && typeof Blob !== 'undefined') {
      // Modern Node.js with FormData support
      formData = new FormData();
      const blob = new Blob([fileContent], { type: mimeType });
      formData.append('metadata', JSON.stringify({
        file: {
          displayName: fileName,
        },
      }));
      formData.append('file', blob, fileName);
      contentType = 'multipart/form-data'; // Browser/Node.js will set boundary
    } else {
      // Fallback: construct multipart/form-data manually
      const boundary = `----WebKitFormBoundary${Date.now()}`;
      const metadata = JSON.stringify({
        file: {
          displayName: fileName,
        },
      });
      
      // Construct multipart/form-data manually
      const parts: Buffer[] = [];
      
      // Metadata part
      parts.push(Buffer.from(`--${boundary}\r\n`));
      parts.push(Buffer.from(`Content-Disposition: form-data; name="metadata"\r\n`));
      parts.push(Buffer.from(`Content-Type: application/json\r\n\r\n`));
      parts.push(Buffer.from(metadata));
      parts.push(Buffer.from(`\r\n`));
      
      // File part
      parts.push(Buffer.from(`--${boundary}\r\n`));
      parts.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`));
      parts.push(Buffer.from(`Content-Type: ${mimeType}\r\n\r\n`));
      parts.push(fileContent);
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
      
      formData = Buffer.concat(parts);
      contentType = `multipart/form-data; boundary=${boundary}`;
    }

    console.log(`[Gemini Files] Uploading file: ${fileName} (${fileContent.length} bytes, ${mimeType})`);

    const headers: Record<string, string> = { 'x-goog-api-key': apiKey };
    if (Buffer.isBuffer(formData)) {
      headers['Content-Type'] = contentType!;
    }
    
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers,
      body: formData,
    });
    
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error(`[Gemini Files] Upload failed with status ${uploadResponse.status}:`, errorText);
      throw new Error(`Gemini file upload failed (${uploadResponse.status}): ${errorText}`);
    }

    const uploadData = await uploadResponse.json();
    const fileUri = uploadData.file?.uri || uploadData.uri;

    if (!fileUri) {
      throw new Error('Gemini file upload did not return a file URI');
    }

    console.log(`[Gemini Files] Successfully uploaded ${fileName}, URI: ${fileUri}`);

    // Wait for file to be processed
    await waitForFileProcessing(fileUri, apiKey);

    return {
      fileUri,
      fileName,
      mimeType,
    };
  } catch (error) {
    console.error(`[Gemini Files] Error uploading file for asset ${asset.id}:`, error);
    throw error;
  }
}

/**
 * Wait for a file to be processed by Gemini
 * @param fileUri The file URI returned from upload
 * @param apiKey Google API key
 */
async function waitForFileProcessing(fileUri: string, apiKey: string, maxWaitMs: number = 30000): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 1000; // 1 second

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const fileId = fileUri.split('/').pop();
      const statusUrl = `https://generativelanguage.googleapis.com/v1beta/files/${fileId}`;
      
      const statusResponse = await fetch(statusUrl, { headers: { 'x-goog-api-key': apiKey } });
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        const state = statusData.state;
        
        if (state === 'ACTIVE') {
          console.log(`[Gemini Files] File ${fileId} is ready`);
          return;
        }
        
        if (state === 'FAILED') {
          throw new Error(`File processing failed: ${statusData.error?.message || 'Unknown error'}`);
        }
      }
    } catch (error) {
      console.warn(`[Gemini Files] Error checking file status:`, error);
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  console.warn(`[Gemini Files] File processing timeout, proceeding anyway`);
}


