import yaml from 'js-yaml';
import { KnowledgeDocument } from "@shared/schema/knowledge-base.js";

/**
 * Serializes and parses Knowledge Documents to and from Google's Open Knowledge Format (OKF).
 * OKF v0.1 consists of YAML frontmatter and a Markdown body.
 */

export interface OKFFrontmatter {
    title: string;
    type?: string;
    description?: string;
    tags?: string[];
    timestamp?: string;
    url?: string;
    sourceType?: string;
    externalId?: string;
    [key: string]: any; // Catch-all for extra metadata
}

export class OKFSerializer {
    
    /**
     * Serializes a KnowledgeDocument database record into an OKF formatted string.
     */
    static serialize(doc: Partial<KnowledgeDocument>, tags: string[] = []): string {
        const metadata: any = doc.metadata || {};
        
        const frontmatter: OKFFrontmatter = {
            title: doc.title || "Untitled",
            type: metadata.type || "document",
            description: doc.summary || undefined,
            tags: metadata.tags || tags,
            timestamp: doc.updatedAt ? doc.updatedAt.toISOString() : (doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString()),
            url: doc.url || undefined,
            sourceType: doc.sourceType || undefined,
            externalId: doc.externalId || undefined
        };
        
        // Remove undefined properties to keep frontmatter clean
        Object.keys(frontmatter).forEach(key => {
            if (frontmatter[key] === undefined) {
                delete frontmatter[key];
            }
        });

        // Convert the metadata fields not strictly standard if they exist in doc metadata
        const additionalFields = Object.keys(metadata).filter(k => !['type', 'tags'].includes(k));
        for (const field of additionalFields) {
             if (frontmatter[field] === undefined) {
                 frontmatter[field] = metadata[field];
             }
        }

        const yamlString = yaml.dump(frontmatter, { skipInvalid: true });
        
        const content = doc.textContent || doc.fileData || "";
        
        return `---\n${yamlString}---\n\n${content}`;
    }

    /**
     * Parses an OKF formatted string back into a partial KnowledgeDocument representation
     */
    static parse(okfString: string): { frontmatter: OKFFrontmatter, content: string } {
        const match = okfString.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
        
        if (!match) {
            // Fallback if no frontmatter is found, treat whole string as content
            return {
                frontmatter: { title: "Untitled Document", type: "document" },
                content: okfString.trim()
            };
        }
        
        const yamlStr = match[1];
        const contentStr = match[2];
        
        let frontmatter: any = {};
        try {
            frontmatter = yaml.load(yamlStr) || {};
        } catch (err) {
            console.error("Failed to parse OKF YAML frontmatter:", err);
            frontmatter = { title: "Untitled Document (Parse Error)", type: "document" };
        }
        
        return {
            frontmatter: frontmatter as OKFFrontmatter,
            content: contentStr.trim()
        };
    }
}
