/**
 * Import Jira REST API v3 OpenAPI Specification
 * 
 * Note: Jira doesn't provide an official OpenAPI spec, so we'll need to:
 * 1. Use a community-maintained spec, or
 * 2. Generate one from Jira API documentation, or
 * 3. Create a minimal spec with common operations
 * 
 * For now, this script will create a basic spec structure that can be enhanced.
 */

import 'dotenv/config';
import { db } from "../server/db/index.js";
import { apiSpecs, orgSpecAccess, orgs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

// Basic Jira REST API v3 OpenAPI spec structure
// This is a minimal spec - can be enhanced with more operations
const jiraOpenAPISpec = {
    openapi: "3.1.0",
    info: {
        title: "Jira REST API",
        description: "Jira REST API v3 - Issue management, search, and workflow operations",
        version: "3.0.0",
        contact: {
            name: "Atlassian",
            url: "https://developer.atlassian.com/cloud/jira/platform/rest/v3/"
        }
    },
    servers: [
        {
            url: "https://{domain}.atlassian.net",
            description: "Jira Cloud instance (domain will be overridden by credential baseUrl)",
            variables: {
                domain: {
                    default: "your-domain",
                    description: "Your Jira Cloud domain"
                }
            }
        }
    ],
    components: {
        securitySchemes: {
            BasicAuth: {
                type: "http",
                scheme: "basic",
                description: "Basic authentication using email and API token"
            }
        },
        schemas: {
            Issue: {
                type: "object",
                properties: {
                    key: { type: "string", description: "Issue key (e.g., PROJ-123)" },
                    fields: {
                        type: "object",
                        description: "Issue fields"
                    }
                }
            },
            IssueCreate: {
                type: "object",
                required: ["fields"],
                properties: {
                    fields: {
                        type: "object",
                        required: ["project", "issuetype", "summary"],
                        properties: {
                            project: {
                                type: "object",
                                properties: {
                                    key: { type: "string" }
                                }
                            },
                            issuetype: {
                                type: "object",
                                properties: {
                                    name: { type: "string" }
                                }
                            },
                            summary: { type: "string" },
                            description: { type: "string" }
                        }
                    }
                }
            },
            IssueUpdate: {
                type: "object",
                properties: {
                    fields: {
                        type: "object",
                        description: "Fields to update"
                    }
                }
            },
            JQLSearch: {
                type: "object",
                required: ["jql"],
                properties: {
                    jql: { type: "string", description: "JQL query string" },
                    startAt: { type: "integer", default: 0 },
                    maxResults: { type: "integer", default: 50 },
                    fields: {
                        type: "array",
                        items: { type: "string" },
                        description: "Fields to return"
                    }
                }
            }
        }
    },
    paths: {
        "/rest/api/3/issue": {
            post: {
                operationId: "CreateIssue",
                summary: "Create issue",
                description: "Creates an issue or a sub-task from a JSON representation",
                security: [{ BasicAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/IssueCreate" }
                        }
                    }
                },
                responses: {
                    "201": {
                        description: "Issue created successfully",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/Issue" }
                            }
                        }
                    }
                }
            }
        },
        "/rest/api/3/issue/{issueIdOrKey}": {
            get: {
                operationId: "GetIssue",
                summary: "Get issue",
                description: "Returns the details for an issue",
                security: [{ BasicAuth: [] }],
                parameters: [
                    {
                        name: "issueIdOrKey",
                        in: "path",
                        required: true,
                        schema: { type: "string" },
                        description: "The ID or key of the issue"
                    },
                    {
                        name: "fields",
                        in: "query",
                        schema: {
                            type: "array",
                            items: { type: "string" }
                        },
                        description: "A list of fields to return for the issue"
                    },
                    {
                        name: "expand",
                        in: "query",
                        schema: { type: "string" },
                        description: "Use expand to include additional information about issues"
                    }
                ],
                responses: {
                    "200": {
                        description: "Issue details",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/Issue" }
                            }
                        }
                    }
                }
            },
            put: {
                operationId: "UpdateIssue",
                summary: "Edit issue",
                description: "Edits an issue. A transition may be applied and issue properties updated as part of the edit",
                security: [{ BasicAuth: [] }],
                parameters: [
                    {
                        name: "issueIdOrKey",
                        in: "path",
                        required: true,
                        schema: { type: "string" },
                        description: "The ID or key of the issue"
                    },
                    {
                        name: "notifyUsers",
                        in: "query",
                        schema: { type: "boolean" },
                        description: "Whether a notification email about the issue update is sent to all watchers"
                    },
                    {
                        name: "overrideScreenSecurity",
                        in: "query",
                        schema: { type: "boolean" },
                        description: "Whether screen security is overridden"
                    },
                    {
                        name: "overrideEditableFlag",
                        in: "query",
                        schema: { type: "boolean" },
                        description: "Whether the issue's editable fields should be overridden"
                    }
                ],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/IssueUpdate" }
                        }
                    }
                },
                responses: {
                    "204": {
                        description: "Issue updated successfully"
                    }
                }
            }
        },
        "/rest/api/3/search": {
            post: {
                operationId: "SearchIssues",
                summary: "Search for issues using JQL",
                description: "Searches for issues using JQL (Jira Query Language)",
                security: [{ BasicAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/JQLSearch" }
                        }
                    }
                },
                responses: {
                    "200": {
                        description: "Search results",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        expand: { type: "string" },
                                        startAt: { type: "integer" },
                                        maxResults: { type: "integer" },
                                        total: { type: "integer" },
                                        issues: {
                                            type: "array",
                                            items: { $ref: "#/components/schemas/Issue" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        "/rest/api/3/issue/{issueIdOrKey}/transitions": {
            get: {
                operationId: "GetTransitions",
                summary: "Get transitions",
                description: "Returns either all transitions or a transition that can be performed by the user on an issue",
                security: [{ BasicAuth: [] }],
                parameters: [
                    {
                        name: "issueIdOrKey",
                        in: "path",
                        required: true,
                        schema: { type: "string" },
                        description: "The ID or key of the issue"
                    },
                    {
                        name: "expand",
                        in: "query",
                        schema: { type: "string" },
                        description: "Use expand to include additional information about transitions"
                    },
                    {
                        name: "transitionId",
                        in: "query",
                        schema: { type: "string" },
                        description: "The ID of the transition"
                    }
                ],
                responses: {
                    "200": {
                        description: "Available transitions",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        transitions: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    id: { type: "string" },
                                                    name: { type: "string" },
                                                    to: {
                                                        type: "object",
                                                        properties: {
                                                            name: { type: "string" },
                                                            id: { type: "string" }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            post: {
                operationId: "TransitionIssue",
                summary: "Transition issue",
                description: "Performs an issue transition",
                security: [{ BasicAuth: [] }],
                parameters: [
                    {
                        name: "issueIdOrKey",
                        in: "path",
                        required: true,
                        schema: { type: "string" },
                        description: "The ID or key of the issue"
                    }
                ],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["transition"],
                                properties: {
                                    transition: {
                                        type: "object",
                                        required: ["id"],
                                        properties: {
                                            id: { type: "string" },
                                            name: { type: "string" }
                                        }
                                    },
                                    fields: {
                                        type: "object",
                                        description: "Fields to update during transition"
                                    },
                                    update: {
                                        type: "object",
                                        description: "Update operations to perform"
                                    },
                                    historyMetadata: {
                                        type: "object",
                                        description: "History metadata"
                                    },
                                    properties: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            description: "Additional properties"
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    "204": {
                        description: "Transition completed successfully"
                    }
                }
            }
        }
    }
};

async function main() {
    console.log("Importing Jira REST API v3 OpenAPI Spec...");

    // Check if spec already exists
    const existingSpecs = await db
        .select()
        .from(apiSpecs)
        .where(eq(apiSpecs.name, "Jira REST API"));
    
    let spec;
    if (existingSpecs.length > 0) {
        // Update existing spec
        spec = existingSpecs[0];
        const [updated] = await db
            .update(apiSpecs)
            .set({
                content: jiraOpenAPISpec,
                status: "published",
                isSystemLevel: true,
                updatedAt: new Date()
            })
            .where(eq(apiSpecs.id, spec.id))
            .returning();
        spec = updated;
        console.log(`Spec updated (ID: ${spec.id})`);
    } else {
        // Insert new spec
        const [newSpec] = await db.insert(apiSpecs).values({
            name: "Jira REST API",
            description: "Jira REST API v3 - Issue management, search, and workflow operations",
            content: jiraOpenAPISpec,
            status: "published",
            isSystemLevel: true
        }).returning();
        spec = newSpec;
        console.log(`Spec created with ID: ${spec.id}`);
    }

    // Grant access to all organizations
    const allOrgs = await db.select().from(orgs);
    console.log(`Granting access to ${allOrgs.length} organizations...`);

    for (const org of allOrgs) {
        await db.insert(orgSpecAccess).values({
            specId: spec.id,
            orgId: org.id
        }).onConflictDoNothing();
        console.log(`- Access granted to Org ${org.id} (${org.name})`);
    }

    console.log("\n✅ Jira OpenAPI spec imported successfully!");
    console.log("\nNote: This is a minimal spec with common operations.");
    console.log("You can enhance it by adding more endpoints from the Jira API documentation.");
    console.log("\nAvailable operations:");
    console.log("  - CreateIssue: POST /rest/api/3/issue");
    console.log("  - GetIssue: GET /rest/api/3/issue/{issueIdOrKey}");
    console.log("  - UpdateIssue: PUT /rest/api/3/issue/{issueIdOrKey}");
    console.log("  - SearchIssues: POST /rest/api/3/search");
    console.log("  - GetTransitions: GET /rest/api/3/issue/{issueIdOrKey}/transitions");
    console.log("  - TransitionIssue: POST /rest/api/3/issue/{issueIdOrKey}/transitions");
    
    process.exit(0);
}

main().catch(console.error);

