/**
 * Oddjob MCP Server - Document Tools
 * 
 * Exposes tools for RAG-based document search and retrieval
 * through the Model Context Protocol.
 */

import { z } from "zod";

export const documentToolDefinitions = [
    {
        name: "search_documents",
        description: "Semantic search across all documents in the knowledge store using RAG (Retrieval Augmented Generation). Returns relevant text chunks that match the query. Use this for finding information in documentation, runbooks, API specs, and other stored documents.",
        inputSchema: {
            type: "object" as const,
            properties: {
                query: {
                    type: "string",
                    description: "Natural language query (e.g., 'How do I deploy to production?', 'What are the API rate limits?')",
                },
                limit: {
                    type: "number",
                    description: "Maximum number of document chunks to return. Default: 5, Max: 100",
                },
                minScore: {
                    type: "number",
                    description: "Minimum relevance score (0-1). Default: 0.5",
                },
            },
            required: ["query"],
        },
    },
    {
        name: "list_documents",
        description: "List all documents in the knowledge store. Returns document metadata without full content.",
        inputSchema: {
            type: "object" as const,
            properties: {
                limit: {
                    type: "number",
                    description: "Maximum documents to return. Default: 20",
                },
                search: {
                    type: "string",
                    description: "Filter by document title or filename",
                },
            },
        },
    },
    {
        name: "get_document_content",
        description: "Retrieve the full content of a specific document by ID.",
        inputSchema: {
            type: "object" as const,
            properties: {
                documentId: {
                    type: "number",
                    description: "Document ID",
                },
            },
            required: ["documentId"],
        },
    },
    {
        name: "search_unified_knowledge",
        description: "Unified hybrid search across ALL knowledge sources (Documents, Graph Entities, Datasets). Uses both semantic (vector) and keyword search. Best tool for general information retrieval.",
        inputSchema: {
            type: "object" as const,
            properties: {
                query: {
                    type: "string",
                    description: "Search query",
                },
                limit: {
                    type: "number",
                    description: "Max results (default: 10)",
                },
                types: {
                    type: "array",
                    items: { type: "string", enum: ["document", "graph_node", "dataset_row"] },
                    description: "Optional filter for content types",
                },
                sourceTypes: {
                    type: "array",
                    items: { type: "string", enum: ["jira", "confluence", "file", "web", "text"] },
                    description: "Optional: Filter by source (e.g. ['confluence'] to only see wiki pages, ['jira'] for tickets)",
                },
                sortBy: {
                    type: "string",
                    enum: ["relevance", "recency"],
                    description: "Sort order: 'relevance' (default) or 'recency' (prioritize new content)",
                },
            },
            required: ["query"],
        },
    },
];

export const SearchUnifiedInput = z.object({
    query: z.string().min(1),
    limit: z.number().min(1).max(100).default(10),
    types: z.array(z.enum(["document", "graph_node", "dataset_row"])).optional(),
    sourceTypes: z.array(z.enum(["jira", "confluence", "file", "web", "text"])).optional(),
    sortBy: z.enum(["relevance", "recency"]).optional().default("relevance"),
});

// Input validation schemas
export const SearchDocumentsInput = z.object({
    query: z.string().min(1),
    limit: z.number().min(1).max(100).default(5),
    minScore: z.number().min(0).max(1).default(0.5),
});

export const ListDocumentsInput = z.object({
    limit: z.number().min(1).max(100).default(20),
    search: z.string().optional(),
});

export const GetDocumentContentInput = z.object({
    documentId: z.number(),
});

