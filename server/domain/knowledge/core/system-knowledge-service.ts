import fs from "node:fs";
import path from "node:path";
import { graphService } from "./graph/graph-service.js";
import { documentService } from "./extraction/document-service.js";
import { createLogger } from "@server/utils/logger.js";
import { BadRequestError } from "@server/utils/errors.js";
import { orgs, knowledgeNodes, knowledgeEdges, knowledgeDocuments, hilForms, agentDeployments, systemDependencies } from "@shared/schema/index.js";
import { db } from "@server/database_service.js";
import { eq, inArray } from "drizzle-orm";
import { cacheService } from "../../../domain/core/cache-service.js";

const logger = createLogger("SystemKnowledgeService");

// Reserved User ID for System Knowledge
const SYSTEM_USER_ID = "oddjob-system";

export const systemKnowledgeService = {
    /**
     * Ensure a dedicated System Organization exists.
     */
    async ensureSystemOrg() {
        logger.info("Ensuring System Org exists...");
        const [existing] = await db.select().from(orgs).where(eq(orgs.name, "Oddjob System")).limit(1);
        if (existing) {
            logger.info(`Found existing System Org: ${existing.id}`);
            return existing.id;
        }

        logger.info("System Org not found, creating...");
        const [created] = await db.insert(orgs).values({
            name: "Oddjob System",
        }).returning();
        logger.info(`Created System Org: ${created.id}`);
        return created.id;
    },

    /**
     * Clear all nodes, edges, and documents for the System Org.
     */
    async clearSystemKnowledge(orgContext: any) {
        logger.info(`Clearing existing system knowledge for org: ${orgContext.organizationId}`);
        try {
            await db.delete(knowledgeEdges).where(eq(knowledgeEdges.organizationId, orgContext.organizationId));
            await db.delete(knowledgeNodes).where(eq(knowledgeNodes.organizationId, orgContext.organizationId));
            await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.organizationId, orgContext.organizationId));

            // Clear Redis cache for knowledge queries
            await cacheService.clearByTags(["knowledge"]);
            logger.info("Successfully cleared system knowledge and cache.");
        } catch (error) {
            logger.error("Error clearing knowledge:", error);
        }
    },

    /**
     * Ingest memory documents, codebase structure, and API routes into the system knowledge graph.
     */
    async ingestSystemMemory(brainDir?: string, projectRoot: string = process.cwd()) {
        const effectiveBrainDir = brainDir || path.join(process.env.USERPROFILE || process.env.HOME || "", ".gemini/antigravity/brain");
        logger.info(`Starting ingestion of system memory and codebase from: ${projectRoot}`);

        const systemOrgId = await this.ensureSystemOrg();
        const orgContext = { organizationId: systemOrgId, userId: SYSTEM_USER_ID };

        // 0. Clear existing data to avoid duplicates and ensure clean relationships
        await this.clearSystemKnowledge(orgContext);

        const nodeCache = new Map<string, number>(); // key: "label:name", value: node.id
        const routeMap = new Map<string, string>(); // path -> componentName

        // 1. Discover Routes from App.tsx
        await this.discoverRoutes(projectRoot, routeMap);

        // 2. Ingest Brain Documents (Antigravity Memory)
        if (effectiveBrainDir && fs.existsSync(effectiveBrainDir)) {
            await this.ingestDocumentsFromDir(effectiveBrainDir, "memory_doc", orgContext, nodeCache);
        }

        // 2b. Ingest Project Specifications
        const specsDir = path.join(projectRoot, "docs", "specs");
        if (fs.existsSync(specsDir)) {
            await this.ingestDocumentsFromDir(specsDir, "system_spec", orgContext, nodeCache);
        }

        // 2c. Ingest Assistant Knowledge
        const knowledgeDir = path.join(projectRoot, "server", "knowledge");
        if (fs.existsSync(knowledgeDir)) {
            await this.ingestDocumentsFromDir(knowledgeDir, "assistant_knowledge", orgContext, nodeCache);
        }

        // 3. Ingest Schemas
        await this.scanSchemas(projectRoot, orgContext, nodeCache);

        // 4. Ingest Codebase Structure (services + domain services)
        await this.scanCodebase(projectRoot, orgContext, nodeCache);

        const uiFiles: Array<{ path: string, label: string, componentName: string, nodeId: number }> = [];
        await this.scanUiComponents(projectRoot, orgContext, nodeCache, uiFiles);
        await this.mapUiRelationships(projectRoot, orgContext, nodeCache, uiFiles, routeMap);

        // 5. Ingest API Routes
        await this.scanApiRoutes(projectRoot, orgContext, nodeCache);

        // 6. Ingest MCP Tools (capabilities directory + live servers)
        await this.scanMcpTools(projectRoot, orgContext, nodeCache);

        // 7. Ingest System Dependencies
        await this.scanDependencies(orgContext, nodeCache);

        // 8. Ingest Form Agents (HIL & Deployments)
        await this.scanFormAgents(orgContext, nodeCache);

        // 9. Add explicit Feature nodes for new platform capabilities
        await this.scanPlatformFeatures(orgContext, nodeCache);
        
        // Final connectivity pass: relationships between entities across domains
        await this.scanCodebaseRelationships(projectRoot, orgContext, nodeCache);

        logger.info(`System ingestion complete. Nodes created: ${nodeCache.size}`);
        return { status: "success", nodeCount: nodeCache.size };
    },

    /**
     * Helper to ingest all markdown files from a directory.
     */
    async ingestDocumentsFromDir(dir: string, sourceType: string, orgContext: any, nodeCache: Map<string, number>) {
        const files = this.findMarkdownFiles(dir);
        for (const file of files) {
            try {
                const content = fs.readFileSync(file, "utf-8");
                const fileName = path.basename(file);
                const relativeTitle = path.relative(dir, file);

                const doc = await documentService.createDocument({
                    title: relativeTitle,
                    textContent: content,
                    sourceType: sourceType as any,
                    metadata: { filePath: file }
                }, orgContext);

                const features = this.extractFeatures(content);
                const docNode = await graphService.createNode({
                    label: "Document",
                    name: relativeTitle,
                    properties: { path: file, sourceType },
                    data: {},
                    knowledgeDocumentId: doc.id,
                    extractionSources: [],
                    verificationStatus: "verified"
                }, orgContext);
                nodeCache.set(`Document:${fileName}`, docNode.id);

                for (const featureName of features) {
                    const node = await graphService.createNode({
                        label: "Feature",
                        name: featureName,
                        properties: { source: fileName },
                        data: {},
                        knowledgeDocumentId: doc.id,
                        extractionSources: [],
                        verificationStatus: "verified"
                    }, orgContext);
                    nodeCache.set(`Feature:${featureName}`, node.id);

                    await graphService.createEdge({
                        sourceNodeId: node.id,
                        targetNodeId: docNode.id,
                        relation: "contained_in",
                        properties: { description: "Defined in document" }
                    }, orgContext);
                }

                const tasks = this.extractTasks(content);
                for (const taskName of tasks) {
                    const node = await graphService.createNode({
                        label: "Task",
                        name: taskName,
                        properties: { source: fileName },
                        data: {},
                        knowledgeDocumentId: doc.id,
                        extractionSources: [],
                        verificationStatus: "verified"
                    }, orgContext);
                    nodeCache.set(`Task:${taskName}`, node.id);

                    await graphService.createEdge({
                        sourceNodeId: node.id,
                        targetNodeId: docNode.id,
                        relation: "defined_in",
                        properties: { description: "Task extracted from file" }
                    }, orgContext);

                    for (const featureName of features) {
                        const featureId = nodeCache.get(`Feature:${featureName}`);
                        if (featureId) {
                            await graphService.createEdge({
                                sourceNodeId: node.id,
                                targetNodeId: featureId,
                                relation: "supports",
                                properties: { description: "Implementation task for feature" }
                            }, orgContext);
                        }
                    }
                }
            } catch (error) {
                logger.error(`Failed to ingest document ${file} for ${sourceType}:`, error);
            }
        }
    },

    async discoverRoutes(projectRoot: string, routeMap: Map<string, string>) {
        const routingFiles = [
            path.join(projectRoot, "client", "src", "App.tsx"),
            path.join(projectRoot, "server", "domain", "core", "ui", "components", "routing", "ArmoryRouting.tsx"),
            path.join(projectRoot, "server", "domain", "core", "ui", "components", "routing", "OperationsRouting.tsx"),
            path.join(projectRoot, "server", "domain", "core", "ui", "components", "routing", "KnowledgeRouting.tsx"),
        ];

        for (const routingPath of routingFiles) {
            if (fs.existsSync(routingPath)) {
                const content = fs.readFileSync(routingPath, "utf-8");
                // Match both <Route path="..." component={...} /> and lazy imports
                const routeMatches = content.matchAll(/<Route\s+[^>]*?path=["']([^"']+)["'][^>]*?(?:component={([^}]+)}|children={|<[^>]*>)/g);
                for (const match of routeMatches) {
                    if (match[2]) routeMap.set(match[1], match[2]);
                }
                
                // Match lazy imports: const Name = lazy(() => import("..."))
                const lazyMatches = content.matchAll(/const\s+([a-zA-Z0-9]+)\s+=\s+lazy\(\(\)\s+=>\s+import\(["']([^"']+)["']\)\)/g);
                for (const match of lazyMatches) {
                    // Map component name for later lookup
                    const componentName = match[1];
                    // Find any route that might use this lazy component (via variable name)
                    const subRouteMatches = content.matchAll(new RegExp(`<Route\\s+[^>]*?path=["']([^"']+)["'][^>]*?component={${componentName}}`, "g"));
                    for (const subMatch of subRouteMatches) {
                        routeMap.set(subMatch[1], componentName);
                    }
                }
            }
        }
        logger.info(`Discovered ${routeMap.size} routes from decentralized routing controllers`);
    },

    async scanSchemas(projectRoot: string, orgContext: any, nodeCache: Map<string, number>) {
        const schemaDir = path.join(projectRoot, "shared", "schema");
        if (fs.existsSync(schemaDir)) {
            await this.recursiveSchemaScan(schemaDir, projectRoot, orgContext, nodeCache);
        }
    },

    async recursiveSchemaScan(dir: string, projectRoot: string, orgContext: any, nodeCache: Map<string, number>) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relPath = path.relative(projectRoot, fullPath);
            if (entry.isDirectory()) {
                await this.recursiveSchemaScan(fullPath, projectRoot, orgContext, nodeCache);
            } else if (entry.name.endsWith(".ts")) {
                const content = fs.readFileSync(fullPath, "utf-8");
                const modelMatches = content.matchAll(/export const\s+([a-zA-Z0-9]+)\s+=\s+(?:pgTable|z\.object)/g);
                for (const match of modelMatches) {
                    const modelName = match[1];
                    const node = await graphService.createNode({
                        label: "Schema_Model",
                        name: modelName,
                        properties: { path: relPath },
                        data: {},
                        extractionSources: [],
                        verificationStatus: "verified"
                    }, orgContext);
                    nodeCache.set(`Schema_Model:${modelName}`, node.id);
                }
            }
        }
    },

    async scanCodebase(projectRoot: string, orgContext: any, nodeCache: Map<string, number>) {
        const serviceDir = path.join(projectRoot, "server", "services");
        const schemaModels = Array.from(nodeCache.keys())
            .filter(k => k.startsWith("Schema_Model:"))
            .map(k => k.replace("Schema_Model:", ""));

        if (fs.existsSync(serviceDir)) {
            const files = fs.readdirSync(serviceDir).filter(f => f.endsWith(".ts"));
            for (const file of files) {
                const servicePath = path.join(serviceDir, file);
                const serviceName = file.replace(".ts", "");
                const node = await graphService.createNode({
                    label: "Service",
                    name: serviceName,
                    properties: { path: path.join("server", "services", file) },
                    data: {},
                    extractionSources: [],
                    verificationStatus: "verified"
                }, orgContext);
                nodeCache.set(`Service:${serviceName}`, node.id);

                const content = fs.readFileSync(servicePath, "utf-8");
                for (const modelName of schemaModels) {
                    if (content.includes(modelName)) {
                        const modelId = nodeCache.get(`Schema_Model:${modelName}`);
                        if (modelId) {
                            await graphService.createEdge({
                                sourceNodeId: node.id,
                                targetNodeId: modelId,
                                relation: "uses_schema",
                                properties: { description: "Service interacts with database model" }
                            }, orgContext);
                        }
                    }
                }
            }
        }

        const domainDir = path.join(projectRoot, "server", "domain");
        if (fs.existsSync(domainDir)) {
            const domains = fs.readdirSync(domainDir);
            for (const domain of domains) {
                const domainPath = path.join(domainDir, domain);
                if (fs.statSync(domainPath).isDirectory()) {
                    const node = await graphService.createNode({
                        label: "Domain",
                        name: domain,
                        properties: { path: path.relative(projectRoot, domainPath) },
                        data: {},
                        extractionSources: [],
                        verificationStatus: "verified"
                    }, orgContext);
                    nodeCache.set(`Domain:${domain}`, node.id);
                }
            }
            // Scan all .service.ts files within domain subdirectories
            await this.scanDomainServices(domainDir, projectRoot, orgContext, nodeCache, schemaModels);
        }

        const pagesGroupDir = path.join(projectRoot, "client", "src", "pages");
        if (fs.existsSync(pagesGroupDir)) {
            const folders = fs.readdirSync(pagesGroupDir);
            for (const folder of folders) {
                const folderPath = path.join(pagesGroupDir, folder);
                if (fs.statSync(folderPath).isDirectory() && folder !== "shared") {
                    const node = await graphService.createNode({
                        label: "Component_Group",
                        name: `${folder.charAt(0).toUpperCase() + folder.slice(1)} Pages`,
                        properties: { path: path.join("client", "src", "pages", folder) },
                        data: {},
                        extractionSources: [],
                        verificationStatus: "verified"
                    }, orgContext);
                    nodeCache.set(`Component_Group:${folder}_pages`, node.id);
                }
            }
        }
    },

    async scanUiComponents(projectRoot: string, orgContext: any, nodeCache: Map<string, number>, uiFiles: any[]) {
        const uiDirs = [
            { path: path.join(projectRoot, "client", "src", "components"), label: "Component", group: true },
            { path: path.join(projectRoot, "client", "src", "pages"), label: "Page", group: false }
        ];

        // Scan Domain-Driven UI
        const domainDir = path.join(projectRoot, "server", "domain");
        if (fs.existsSync(domainDir)) {
            const domains = fs.readdirSync(domainDir);
            for (const domain of domains) {
                const domainUiPath = path.join(domainDir, domain, "ui");
                if (fs.existsSync(domainUiPath)) {
                    uiDirs.push({ path: path.join(domainUiPath, "components"), label: "Component", group: true });
                    uiDirs.push({ path: path.join(domainUiPath, "modules"), label: "Module", group: true });
                }
            }
        }

        for (const dirInfo of uiDirs) {
            if (fs.existsSync(dirInfo.path)) {
                await this.recursiveUiNodeCreation(dirInfo.path, dirInfo.label, projectRoot, orgContext, nodeCache, uiFiles);
            }
        }
    },

    async recursiveUiNodeCreation(dir: string, label: string, projectRoot: string, orgContext: any, nodeCache: Map<string, number>, uiFiles: any[]) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relPath = path.relative(projectRoot, fullPath);
            if (entry.isDirectory()) {
                await this.recursiveUiNodeCreation(fullPath, label, projectRoot, orgContext, nodeCache, uiFiles);
            } else if (entry.name.endsWith(".tsx")) {
                const componentName = entry.name.replace(".tsx", "");
                const node = await graphService.createNode({
                    label: label,
                    name: componentName,
                    properties: { path: relPath },
                    data: {},
                    extractionSources: [],
                    verificationStatus: "verified"
                }, orgContext);
                nodeCache.set(`${label}:${componentName}`, node.id);
                uiFiles.push({ path: fullPath, label, componentName, nodeId: node.id });
            }
        }
    },

    async mapUiRelationships(projectRoot: string, orgContext: any, nodeCache: Map<string, number>, uiFiles: any[], routeMap: Map<string, string>) {
        const uiNodeNames = Array.from(nodeCache.keys())
            .filter(k => k.startsWith("Page:") || k.startsWith("Component:"))
            .map(k => k.split(":")[1]);

        for (const fileInfo of uiFiles) {
            const content = fs.readFileSync(fileInfo.path, "utf-8");

            const parentDirName = path.basename(path.dirname(fileInfo.path));
            let parentGroupId = nodeCache.get(`Component_Group:${parentDirName}`);
            
            // For pages, we might have mapped them to "Folder Pages"
            if (!parentGroupId && fileInfo.label === "Page") {
                parentGroupId = nodeCache.get(`Component_Group:${parentDirName}_pages`);
            }

            if (parentGroupId) {
                await graphService.createEdge({
                    sourceNodeId: fileInfo.nodeId,
                    targetNodeId: parentGroupId,
                    relation: "belongs_to",
                    properties: { description: "UI Component structure" }
                }, orgContext);
            }

            // Map Component Composition (USES_COMPONENT)
            for (const compName of uiNodeNames) {
                if (compName === fileInfo.componentName) continue;
                // Simple regex to find JSX usage: <CompName
                const jsxRegex = new RegExp(`<${compName}(?:\\s|/|>)`, "g");
                if (jsxRegex.test(content)) {
                    const targetId = nodeCache.get(`Component:${compName}`) || nodeCache.get(`Page:${compName}`);
                    if (targetId) {
                        await graphService.createEdge({
                            sourceNodeId: fileInfo.nodeId,
                            targetNodeId: targetId,
                            relation: "USES_COMPONENT",
                            properties: { description: "JSX Composition" }
                        }, orgContext);
                    }
                }
            }

            // Broadened Navigation Detection regex
            const navMatches = content.matchAll(/(?:to=|navigate\(|navigate\s*=\s*|url:\s*|href:\s*|href=)(?:['"]([^'"]+)['"]|{['"]([^'"]+)['"]}|{\s*pathname:\s*['"]([^'"]+)['"]\s*})/g);
            for (const match of navMatches) {
                const targetPath = match[1] || match[2] || match[3];
                if (targetPath && (targetPath.startsWith("/") || targetPath.includes(":"))) {
                    const mappedComponent = routeMap.get(targetPath);
                    let pageId: number | undefined;

                    if (mappedComponent) {
                        pageId = nodeCache.get(`Page:${mappedComponent}`) || nodeCache.get(`Component:${mappedComponent}`);
                    }

                    if (!pageId) {
                        const pathParts = targetPath.split("/").filter(Boolean);
                        const pathName = pathParts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join("");
                        const potentialNames = [pathName, `${pathName}Page`];

                        if (targetPath === "/") {
                            potentialNames.push("Dashboard", "DashboardPage", "Home", "HomePage");
                        }

                        for (const name of potentialNames) {
                            pageId = nodeCache.get(`Page:${name}`);
                            if (pageId) break;
                        }
                    }

                    if (pageId) {
                        await graphService.createEdge({
                            sourceNodeId: fileInfo.nodeId,
                            targetNodeId: pageId,
                            relation: "NAVIGATES_TO",
                            properties: { path: targetPath }
                        }, orgContext);
                    }
                }
            }

            // Map API usage (Component -> API_Route)
            const apiNodeNames = Array.from(nodeCache.keys())
                .filter(k => k.startsWith("API_Route:"))
                .map(k => k.split(":")[1]);

            // Search for apiRequest("METHOD", "/path")
            const apiRequestMatches = content.matchAll(/apiRequest\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g);
            for (const match of apiRequestMatches) {
                const method = match[1].toUpperCase();
                const targetPath = match[2];
                const fullRouteName = `${method} ${targetPath}`;
                
                let routeId = nodeCache.get(`API_Route:${fullRouteName}`) || 
                             nodeCache.get(`API_Route_Path:${method}:${targetPath}`);
                             
                // If not found, try suffix matching (e.g. if targetPath is "/api/foo/bar" and we have a route with suffix "/bar")
                if (!routeId) {
                    const suffixes = Array.from(nodeCache.keys()).filter(k => k.startsWith(`API_Route_Path_Suffix:${method}:`));
                    for (const sKey of suffixes) {
                        const suffix = sKey.split(":")[2];
                        if (targetPath.endsWith(suffix)) {
                            routeId = nodeCache.get(sKey);
                            break;
                        }
                    }
                }

                if (routeId) {
                    await graphService.createEdge({
                        sourceNodeId: fileInfo.nodeId,
                        targetNodeId: routeId,
                        relation: "calls_api",
                        properties: { description: "API Interaction" }
                    }, orgContext);
                }
            }
        }
    },

    async scanApiRoutes(projectRoot: string, orgContext: any, nodeCache: Map<string, number>) {
        const schemaModels = Array.from(nodeCache.keys())
            .filter(k => k.startsWith("Schema_Model:"))
            .map(k => k.replace("Schema_Model:", ""));

        const expressRouteDir = path.join(projectRoot, "server", "routes");
        if (fs.existsSync(expressRouteDir)) {
            const files = fs.readdirSync(expressRouteDir).filter(f => f.endsWith(".ts"));
            for (const file of files) {
                const routeFilePath = path.join(expressRouteDir, file);
                const content = fs.readFileSync(routeFilePath, "utf-8");
                const routeMatches = content.matchAll(/router\.(get|post|put|delete|patch)\("([^"]+)"/g);

                const potentialServiceName = file.replace(".ts", "").replace("-system", "").replace("system-", "");
                const serviceId = nodeCache.get(`Service:${potentialServiceName}`) || nodeCache.get(`Service:${potentialServiceName}Service`);

                for (const match of routeMatches) {
                    const method = match[1].toUpperCase();
                    const pathSuffix = match[2];
                    
                    // Attempt to determine prefix based on file name or mount point
                    let prefix = "/api";
                    if (file === "admin-system.ts") prefix = "/api/system-admin-graph";
                    else if (file === "db-metrics.ts") prefix = "/api/admin/db-metrics";
                    else if (file === "supervisor.ts") prefix = "/api/supervisor";
                    else if (file === "governor.ts") prefix = "/api/governor";
                    else if (file === "rescue.ts") prefix = "/api/rescue";
                    else if (file === "rescue-client.ts") prefix = "/api/rescue/v1";
                    else if (file === "analytics.ts") prefix = "/api/analytics";
                    else if (file === "monitoring.ts") prefix = "/api/monitoring";
                    else if (file === "audit-log.ts") prefix = "/api/audit";
                    
                    const fullPath = `${prefix}${pathSuffix.startsWith("/") ? "" : "/"}${pathSuffix}`;
                    const routeName = `${method} ${fullPath}`;
                    
                    const node = await graphService.createNode({
                        label: "API_Route",
                        name: routeName,
                        properties: { type: "express", file: file, method, path: fullPath },
                        data: {},
                        extractionSources: [],
                        verificationStatus: "verified"
                    }, orgContext);
                    nodeCache.set(`API_Route:${routeName}`, node.id);
                    // Also cache by the short name and just the path for flexible matching
                    nodeCache.set(`API_Route_Path:${method}:${fullPath}`, node.id);
                    nodeCache.set(`API_Route_Path_Suffix:${method}:${pathSuffix}`, node.id);

                    if (serviceId) {
                        await graphService.createEdge({
                            sourceNodeId: node.id,
                            targetNodeId: serviceId,
                            relation: "calls",
                            properties: { description: "API Route invokes service logic" }
                        }, orgContext);
                    }

                    for (const modelName of schemaModels) {
                        if (content.includes(modelName)) {
                            const modelId = nodeCache.get(`Schema_Model:${modelName}`);
                            if (modelId) {
                                await graphService.createEdge({
                                    sourceNodeId: node.id,
                                    targetNodeId: modelId,
                                    relation: "uses_schema",
                                    properties: { description: "API Route interacts with database model" }
                                }, orgContext);
                            }
                        }
                    }
                }
            }
        }

        // Also scan *.route.ts files in server/domain/ (domain-co-located routes)
        const domainRouteFiles = this.findFilesByPattern(
            path.join(projectRoot, "server", "domain"),
            /\.route\.ts$/,
            ["ui", "node_modules", "__tests__", "tests"]
        );
        for (const file of domainRouteFiles) {
            const content = fs.readFileSync(file, "utf-8");
            const routeMatches = content.matchAll(/router\.(get|post|put|delete|patch)\("([^"]+)"/g);
            const fileName = path.basename(file);
            // Infer prefix from domain path: server/domain/<domain>/...
            const relParts = path.relative(path.join(projectRoot, "server", "domain"), file).split(path.sep);
            const domainName = relParts[0];
            const prefix = `/api/${domainName}`;
            for (const match of routeMatches) {
                const method = match[1].toUpperCase();
                const pathSuffix = match[2];
                const fullPath = `${prefix}${pathSuffix.startsWith("/") ? "" : "/"}${pathSuffix}`;
                const routeName = `${method} ${fullPath}`;
                if (!nodeCache.has(`API_Route:${routeName}`)) {
                    const node = await graphService.createNode({
                        label: "API_Route",
                        name: routeName,
                        properties: { type: "domain-express", file: fileName, method, path: fullPath, domain: domainName },
                        data: {},
                        extractionSources: [],
                        verificationStatus: "verified"
                    }, orgContext);
                    nodeCache.set(`API_Route:${routeName}`, node.id);
                    nodeCache.set(`API_Route_Path:${method}:${fullPath}`, node.id);
                    nodeCache.set(`API_Route_Path_Suffix:${method}:${pathSuffix}`, node.id);
                }
            }
        }

        const fastapiRouteDir = path.join(projectRoot, "backend", "api", "routes");
        if (fs.existsSync(fastapiRouteDir)) {
            await this.scanPythonRoutes(fastapiRouteDir, orgContext, nodeCache);
        }
    },

    async scanPythonRoutes(dir: string, orgContext: any, nodeCache: Map<string, number>) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await this.scanPythonRoutes(fullPath, orgContext, nodeCache);
            } else if (entry.name.endsWith(".py")) {
                const content = fs.readFileSync(fullPath, "utf-8");
                const routeMatches = content.matchAll(/@router\.(get|post|put|delete|patch)\("([^"]+)"/g);
                for (const match of routeMatches) {
                    await graphService.createNode({
                        label: "API_Route",
                        name: `${match[1].toUpperCase()} ${match[2]}`,
                        properties: { type: "fastapi", file: entry.name },
                        data: {},
                        extractionSources: [],
                        verificationStatus: "verified"
                    }, orgContext);
                }
            }
        }
    },

    async scanDependencies(orgContext: any, nodeCache: Map<string, number>) {
        logger.info("[SystemKnowledgeService] Scanning System Dependencies...");
        const deps = await db.select().from(systemDependencies);

        // Create a parent node for the registry
        const registryNode = await graphService.createNode({
            label: "Infrastructure",
            name: "NPM Package Registry",
            properties: { type: "REGISTRY" }
        }, orgContext);

        for (const dep of deps) {
            const node = await graphService.createNode({
                label: "Package",
                name: dep.name,
                properties: {
                    version: dep.version,
                    license: dep.license,
                    feature: dep.feature,
                    alerts: dep.securityAlertsCount
                }
            }, orgContext);

            if (node && registryNode) {
                await graphService.createEdge({
                    sourceNodeId: node.id,
                    targetNodeId: registryNode.id,
                    relation: "registered_in",
                    properties: { description: "Dependency managed in registry" }
                }, orgContext);
            }
        }
    },

    async scanMcpTools(projectRoot: string, orgContext: any, nodeCache: Map<string, number>) {
        // 1. Scan the capabilities directory for all registered tool definitions
        const capabilitiesDir = path.join(projectRoot, "server", "domain", "tools", "v1", "capabilities");
        if (fs.existsSync(capabilitiesDir)) {
            const files = fs.readdirSync(capabilitiesDir).filter(f =>
                f.endsWith(".ts") && f !== "index.ts" && f !== "types.ts"
            );
            for (const file of files) {
                const content = fs.readFileSync(path.join(capabilitiesDir, file), "utf-8");
                const group = file.replace(".ts", "").replace(/-tools$/, "").replace(/_/g, " ");
                // Match: name: "tool_name" or 'tool_name'
                const toolMatches = content.matchAll(/name:\s*["']([a-z_][a-z0-9_]*)["']/g);
                for (const match of toolMatches) {
                    const toolName = match[1];
                    const cacheKey = `MCP_Tool:${toolName}`;
                    if (!nodeCache.has(cacheKey)) {
                        const node = await graphService.createNode({
                            label: "MCP_Tool",
                            name: toolName,
                            properties: { source: file, group }
                        }, orgContext);
                        if (node) nodeCache.set(cacheKey, node.id);
                    }
                }
            }
        }

        // 2. Merge live tools from connected external MCP servers
        try {
            const { mcpClientService } = await import("../../integrations/core/mcp-client.service.js");
            const liveMcpTools = mcpClientService.getAllTools();
            for (const tool of liveMcpTools) {
                const cacheKey = `MCP_Tool:${tool.name}`;
                if (!nodeCache.has(cacheKey)) {
                    const node = await graphService.createNode({
                        label: "MCP_Tool",
                        name: tool.name,
                        properties: { source: "live_mcp_server", group: (tool as any).group ?? "External MCP" }
                    }, orgContext);
                    if (node) nodeCache.set(cacheKey, node.id);
                }
            }
        } catch (err: any) {
            logger.warn(`[SystemKnowledgeService] Could not merge live MCP tools: ${err.message}`);
        }
    },

    async scanFormAgents(orgContext: any, nodeCache: Map<string, number>) {
        logger.info("[SystemKnowledgeService] Scanning Form Agents...");

        // 1. Ingest HIL Forms
        // Templates only: runtime requests and stored responses are not forms the
        // platform offers, and ingesting them filled the graph with one node per ask.
        const { and: allOf } = await import("drizzle-orm");
        const forms = await db.select().from(hilForms).where(allOf(eq(hilForms.isArchived, false), eq(hilForms.kind, "template")));
        for (const form of forms) {
            const externalId = `hil-form-${form.id}`;
            const node = await graphService.createNode({
                label: "FormAgent",
                name: form.name,
                externalId,
                properties: {
                    description: form.description,
                    type: "HIL_FORM",
                    formId: form.id,
                    domain: "system"
                }
            }, orgContext);
            if (node) nodeCache.set(externalId, node.id);
        }

        // 2. Ingest Agent Deployments
        const deployments = await db.select().from(agentDeployments).where(eq(agentDeployments.isActive, true));
        for (const dep of deployments) {
            const externalId = `agent-deployment-${dep.id}`;
            const node = await graphService.createNode({
                label: "FormAgent",
                name: dep.title,
                externalId,
                properties: {
                    description: dep.description,
                    type: "AGENT_DEPLOYMENT",
                    slug: dep.slug,
                    deploymentId: dep.id,
                    domain: "knowledge"
                }
            }, orgContext);
            if (node) nodeCache.set(externalId, node.id);
        }
    },

    /**
     * Recursively find all files matching a pattern under a directory,
     * skipping any directory names in the excludeDirs set.
     */
    findFilesByPattern(dir: string, pattern: RegExp, excludeDirs: string[] = [], list: string[] = []): string[] {
        if (!fs.existsSync(dir)) return list;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!excludeDirs.includes(entry.name)) this.findFilesByPattern(full, pattern, excludeDirs, list);
            } else if (pattern.test(entry.name)) {
                list.push(full);
            }
        }
        return list;
    },

    /**
     * Scan all .service.ts files within server/domain/ and create Service nodes.
     * Also links each service to its parent Domain node and any schema models it references.
     */
    async scanDomainServices(domainDir: string, projectRoot: string, orgContext: any, nodeCache: Map<string, number>, schemaModels: string[]) {
        const serviceFiles = this.findFilesByPattern(domainDir, /\.service\.ts$/, ["ui", "node_modules", "__tests__", "tests"]);
        logger.info(`[SystemKnowledgeService] Found ${serviceFiles.length} domain service files`);

        for (const file of serviceFiles) {
            const serviceName = path.basename(file, ".ts");
            const relPath = path.relative(projectRoot, file);
            const domainName = path.relative(domainDir, file).split(path.sep)[0];

            const cacheKey = `Service:${serviceName}`;
            if (nodeCache.has(cacheKey)) continue; // already created by legacy scan

            const node = await graphService.createNode({
                label: "Service",
                name: serviceName,
                properties: { path: relPath, domain: domainName },
                data: {},
                extractionSources: [],
                verificationStatus: "verified"
            }, orgContext);
            if (!node) continue;
            nodeCache.set(cacheKey, node.id);

            // Link to parent Domain
            const domainId = nodeCache.get(`Domain:${domainName}`);
            if (domainId) {
                await graphService.createEdge({
                    sourceNodeId: node.id,
                    targetNodeId: domainId,
                    relation: "belongs_to",
                    properties: { description: "Service in domain" }
                }, orgContext);
            }

            // Link to any referenced Schema_Models
            const content = fs.readFileSync(file, "utf-8");
            for (const modelName of schemaModels) {
                if (content.includes(modelName)) {
                    const modelId = nodeCache.get(`Schema_Model:${modelName}`);
                    if (modelId) {
                        await graphService.createEdge({
                            sourceNodeId: node.id,
                            targetNodeId: modelId,
                            relation: "uses_schema",
                            properties: { description: "Service interacts with database model" }
                        }, orgContext);
                    }
                }
            }
        }
    },

    /**
     * Creates explicit Feature nodes for new platform capabilities that may not
     * be fully discovered via static code scanning alone.
     */
    /**
     * Scans for deep cross-references between different system entities
     * to build a fully connected graph of inter-edge relationships.
     */
    async scanCodebaseRelationships(projectRoot: string, orgContext: any, nodeCache: Map<string, number>) {
        logger.info("[SystemKnowledgeService] Scanning for deep cross-references...");

        // 1. Link Services to other Services (calls_service).
        //
        // Edges come from resolved *import specifiers*, not substring presence.
        // The previous implementation tested `content.includes(targetName)`
        // against every key in nodeCache, which matched comments and unrelated
        // prose, scaled O(services x cacheEntries), and issued one sequential DB
        // write per false positive.
        const servicesDir = path.join(projectRoot, "server", "domain");
        const serviceFiles = this.findFilesByPattern(servicesDir, /\.service\.ts$/, ["ui", "node_modules"]);

        // Matches static imports, re-exports, dynamic import(), and require().
        const specifierRe = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

        const pending: Array<{ sourceNodeId: number; targetNodeId: number }> = [];

        for (const file of serviceFiles) {
            const serviceName = path.basename(file, ".ts");
            const svcId = nodeCache.get(`Service:${serviceName}`);
            if (!svcId) continue;

            try {
                const content = fs.readFileSync(file, "utf-8");
                const seen = new Set<number>();

                for (const match of content.matchAll(specifierRe)) {
                    // Service nodes are keyed by bare filename, so the specifier's
                    // basename is enough: "@domain/x/foo.service.js" -> "foo.service".
                    const importedName = path.basename(match[1]).replace(/\.(js|ts|jsx|tsx)$/, "");
                    if (!importedName.endsWith(".service")) continue;

                    const targetId = nodeCache.get(`Service:${importedName}`);
                    if (!targetId || targetId === svcId || seen.has(targetId)) continue;
                    seen.add(targetId);
                    pending.push({ sourceNodeId: svcId, targetNodeId: targetId });
                }
            } catch (e) {
                logger.error(`Failed to read service file for relationship scan: ${file}`, e);
            }
        }

        // Write in bounded batches rather than one sequential await per edge.
        const BATCH = 25;
        for (let i = 0; i < pending.length; i += BATCH) {
            await Promise.all(pending.slice(i, i + BATCH).map(edge =>
                graphService.createEdge({
                    ...edge,
                    relation: "calls_service",
                    properties: { description: "Inter-service dependency (resolved import)" }
                }, orgContext).catch((e: any) =>
                    logger.warn(`Failed to create calls_service edge: ${e.message}`)
                )
            ));
        }

        logger.info(`[SystemKnowledgeService] Deep cross-reference scan complete: ${pending.length} inter-service edges`);
    },

    async scanPlatformFeatures(orgContext: any, nodeCache: Map<string, number>) {
        logger.info("[SystemKnowledgeService] Ingesting platform feature nodes...");

        const features: Array<{ name: string; description: string; domain: string; relatedServices?: string[] }> = [
            // App Forge
            { name: "App Forge Pipeline", description: "AI-driven code generation from mission context. Stages: workspace prep → AI codegen → dependency install → Docker build → container start. Emits SSE FORGE_LOG events at each stage.", domain: "apps", relatedServices: ["app-forge.service", "forge-codegen.service"] },
            { name: "App Forge Agentic Synthesis", description: "Multi-turn autonomous synthesis loop in the App Forge. Allows agents to use tools like Stitch, verify output, and fix errors before finalization. Controlled by forge-codegen.service loop logic.", domain: "apps", relatedServices: ["app-forge.service", "forge-codegen.service"] },
            { name: "Stitch Design Synthesis", description: "Autonomous high-fidelity UI creation and design token management via the Stitch Cloud MCP. Enables 'God-Tier' visual aesthetics and semantic design mapping.", domain: "apps", relatedServices: ["app-forge.service", "app-builder.service"] },
            { name: "App Forge UI Specialists", description: "Persona-based synthesis pivoting between a 'UI Architect' (logic/structure) and 'UI Designer' (visuals/aesthetics). Ensures modular and high-fidelity output.", domain: "apps", relatedServices: ["forge-codegen.service"] },
            { name: "App Forge API Instructions", description: "Dedicated 'apiInstructions' field in App Forge step 2. AI Architect is required to implement every listed API as a Next.js server-side proxy route (pages/api/*.ts) to avoid CORS.", domain: "apps", relatedServices: ["app-forge.service", "forge-codegen.service"] },
            { name: "App Builder Chat Enhancement", description: "Interactive chat-to-code loop for deployed apps. Snapshots workspace, sends instructions + source to AI, writes changed files, restarts container via HMR or full rebuild.", domain: "apps", relatedServices: ["app-builder.service"] },
            { name: "App Builder Debug Mode", description: "Debug intent detection in Builder chat. When user mentions 'error', 'not working', 'TypeError' etc., pulls server-side container logs (docker logs) + client-side .client-errors.log and sends both to AI for root-cause fix.", domain: "apps", relatedServices: ["app-builder.service"] },
            { name: "Client-Side Error Relay", description: "Mandatory error telemetry injected into every forged app. pages/api/report-error.ts receives POSTed browser errors; pages/_app.tsx listens for window.onerror + unhandledrejection and posts to the relay. Errors written to .client-errors.log in workspace.", domain: "apps" },
            { name: "App Registry Port Tracking", description: "assignedPort field in apps.runtimeMetadata. Set by startApp() after provisionInstance() and used by the Builder canvas iframe to determine container liveness.", domain: "apps", relatedServices: ["app-registry.service"] },

            // Preview Proxy
            { name: "Preview Proxy Redirect Rewriting", description: "Mach 3 proxy intercepts 301/302/307/308 responses from containers and rewrites absolute localhost:<containerPort> Location headers to go through the /forged/:slug proxy path, preventing ERR_CONNECTION_REFUSED in the Builder canvas iframe.", domain: "apps" },
            { name: "Preview Proxy Public Slug Routing", description: "/app/:slug routes can be numeric IDs, app-{id} prefixes, or custom public slugs (appDeployments.publicSlug). Non-numeric slugs are looked up via publicSlug column instead of apps.slug.", domain: "apps" },

            // Personality / Soul
            { name: "OCEAN Personality Engine", description: "Big Five (Openness, Conscientiousness, Extraversion, Agreeableness, Neuroticism) trait system applied to agent and app deployments. Traits in [0,1] generate personality directives injected into the agent system prompt via buildPersonalityModifier().", domain: "agents", relatedServices: ["app-personality.service"] },
            { name: "Soul Archetype System", description: "Named OCEAN presets: Lead Directive (action-oriented), Ghost Analyst (clinical/detached), The Quartermaster (efficiency-focused). SoulService.generateSoulPrompt() creates the Oddjob Protocol Soul Layer prompt block.", domain: "agents", relatedServices: ["soul.service"] },
            { name: "Soul Evolution / Drift", description: "Agent OCEAN traits drift after mission outcomes. Success → conscientiousness increases. Accuracy failures → conscientiousness + neuroticism increase. Drift applied via SoulService.updateAgentSoul().", domain: "agents", relatedServices: ["soul.service"] },
            { name: "Copilot Personality Configuration", description: "Super Admins can set global OCEAN traits and archetype for the Oddjob Copilot via set_copilot_personality MCP tool. Config stored in systemSettings under key 'copilot_personality'.", domain: "admin", relatedServices: [] },

            // MCP / Tools
            { name: "MCP Tool Registry", description: "Tool discovery from external MCP servers (stdio or SSE transport). Tools are merged into AGENT_TOOLS at runtime via mcpClientService.getAllTools(). Also includes 40+ built-in capability modules in server/domain/tools/v1/capabilities/.", domain: "tools", relatedServices: ["mcp-client.service"] },
            { name: "Admin Personality MCP Tools", description: "Super Admin MCP tools: list_personality_archetypes, list_persona_templates, preview_personality_prompt, get_agent_personality, set_agent_personality, get_copilot_personality, set_copilot_personality, list_agent_personalities. Exposed to the Copilot for conversational personality management.", domain: "tools" },

            // System Graph
            { name: "System Knowledge Graph", description: "Internal knowledge graph of Oddjob's own codebase: Feature, Service, API_Route, MCP_Tool, Schema_Model, Component, Domain, FormAgent, Infrastructure, Package nodes. Rebuilt via Super Admin sync. Used by AI agents for platform introspection.", domain: "knowledge", relatedServices: ["system-knowledge-service"] },
        ];

        for (const feat of features) {
            const existing = nodeCache.get(`Feature:${feat.name}`);
            if (existing) continue;

            const node = await graphService.createNode({
                label: "Feature",
                name: feat.name,
                properties: { description: feat.description, domain: feat.domain },
                data: {},
                extractionSources: [],
                verificationStatus: "verified"
            }, orgContext);
            if (!node) continue;
            nodeCache.set(`Feature:${feat.name}`, node.id);

            // Link to Domain node
            const domainId = nodeCache.get(`Domain:${feat.domain}`);
            if (domainId) {
                await graphService.createEdge({
                    sourceNodeId: node.id,
                    targetNodeId: domainId,
                    relation: "belongs_to",
                    properties: { description: "Feature in domain" }
                }, orgContext);
            }

            // Link to related services
            for (const svcName of (feat.relatedServices ?? [])) {
                const svcId = nodeCache.get(`Service:${svcName}`) ?? nodeCache.get(`Service:${svcName}.service`);
                if (svcId) {
                    await graphService.createEdge({
                        sourceNodeId: node.id,
                        targetNodeId: svcId,
                        relation: "implemented_by",
                        properties: { description: "Feature implemented in service" }
                    }, orgContext);
                }
            }
        }

        logger.info(`[SystemKnowledgeService] Ingested ${features.length} platform feature nodes`);
    },

    findMarkdownFiles(dir: string, fileList: string[] = []): string[] {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const filePath = path.join(dir, file);
            if (fs.statSync(filePath).isDirectory()) {
                this.findMarkdownFiles(filePath, fileList);
            } else if (file.endsWith(".md")) {
                fileList.push(filePath);
            }
        });
        return fileList;
    },

    extractFeatures(content: string): string[] {
        const features: string[] = [];
        // Match # Feature: Name, # Objective: Name, or any # Heading as a concept
        const matches = content.matchAll(/^#+ (?:Feature|Objective|Concept)?\s*:?\s*(.*)/gim);
        for (const match of matches) {
            const val = match[1].trim();
            if (val && !val.toLowerCase().includes("contents") && val.length < 50) {
                features.push(val);
            }
        }
        return [...new Set(features)];
    },

    extractTasks(content: string): string[] {
        const tasks: string[] = [];
        const matches = content.matchAll(/- \[[ |x|/|*]\]\s*(.*?)($| <!--)/gi);
        for (const match of matches) {
            tasks.push(match[1].trim());
        }
        return [...new Set(tasks)];
    },

    async getInternalKnowledgeGraph() {
        logger.info("getInternalKnowledgeGraph called");
        const systemOrgId = await this.ensureSystemOrg();

        // 1. Fetch top 2,000 edges for system org
        const edges = await db
            .select()
            .from(knowledgeEdges)
            .where(eq(knowledgeEdges.organizationId, systemOrgId))
            .limit(2000);

        logger.info(`Fetched ${edges.length} edges for system org ${systemOrgId}`);

        // 2. Collect all referenced node IDs from these edges
        const referencedNodeIds = new Set<number>();
        edges.forEach(e => {
            if (e.sourceId) referencedNodeIds.add(e.sourceId);
            if (e.targetId) referencedNodeIds.add(e.targetId);
        });

        // 3. Fetch nodes matching referencedNodeIds in chunks
        const nodeArray = Array.from(referencedNodeIds);
        let nodes: any[] = [];

        if (nodeArray.length > 0) {
            for (let i = 0; i < nodeArray.length; i += 500) {
                const chunk = nodeArray.slice(i, i + 500);
                const chunkNodes = await db
                    .select()
                    .from(knowledgeNodes)
                    .where(inArray(knowledgeNodes.id, chunk));
                nodes.push(...chunkNodes);
            }
        }

        // 4. If fewer than 1000 nodes total, pad with additional nodes for context
        if (nodes.length < 1000) {
            const nodeMap = new Map(nodes.map(n => [n.id, n]));
            const extraNodes = await db
                .select()
                .from(knowledgeNodes)
                .where(eq(knowledgeNodes.organizationId, systemOrgId))
                .limit(1000 - nodes.length);
            
            extraNodes.forEach(n => {
                if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
            });
            nodes = Array.from(nodeMap.values());
        }

        logger.info(`Returning internal graph with ${nodes.length} nodes and ${edges.length} connected edges`);
        return { nodes, edges };
    }
};


