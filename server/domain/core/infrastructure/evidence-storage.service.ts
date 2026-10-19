import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("EvidenceStorageService");

export class EvidenceStorageService {
  private static client: S3Client | null = null;
  private static bucketName: string = process.env.GARAGE_BUCKET_NAME || "oddjob-evidence";

  private static getClient(): S3Client {
    if (this.client) return this.client;
    
    this.client = new S3Client({
      region: "garage-local",
      endpoint: process.env.GARAGE_ENDPOINT || "http://127.0.0.1:3900",
      credentials: {
        accessKeyId: process.env.GARAGE_ACCESS_KEY || "oddjob-access",
        secretAccessKey: process.env.GARAGE_SECRET_KEY || "oddjob-secret",
      },
      forcePathStyle: true, // Required for Garage/Self-hosted S3
    });
    return this.client;
  }

  /**
   * Stores evidence (JSON, String, or Buffer) in Garage.
   */
  static async store(key: string, content: any, contentType: string = "application/json"): Promise<string> {
    const client = this.getClient();
    let body: any;
    
    if (Buffer.isBuffer(content)) {
        body = content;
    } else {
        body = typeof content === "string" ? content : JSON.stringify(content);
    }
    
    logger.info(`Storing evidence to Garage: ${key} (${contentType})`);

    // --- TRUSTGRAPH HALO BENEFIT: GARAGE S3 STORAGE ---
    if (process.env.USE_GARAGE_STORAGE === "true") {
      try {
        await client.send(new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: body,
          ContentType: contentType
        }));
        
        const url = `${process.env.GARAGE_ENDPOINT || 'http://127.0.0.1:3900'}/${this.bucketName}/${key}`;
        logger.info(`Evidence stored successfully: ${url}`);
        return url;
      } catch (err: any) {
        logger.error(`Failed to store evidence in Garage: ${err.message}`);
        // Fallback or rethrow? 
        throw err;
      }
    }

    // Default: local simulation / return key
    return `local://evidence/${key}`;
  }

  /**
   * Retrieves evidence from Garage or local simulation.
   */
  static async retrieve(url: string): Promise<any> {
    if (url.startsWith("http")) {
      const { data } = await import("axios").then(m => m.default.get(url));
      return data;
    }
    
    if (url.startsWith("local://")) {
      // In a real local sim, we'd read from a file or memory map.
      // For now, we return a mock core to keep the loop moving.
      return { 
        entities: [], 
        relationships: [], 
        reasoning: "Local simulation snapshot context." 
      };
    }

    throw new Error(`Unsupported evidence retrieval URL: ${url}`);
  }
}




