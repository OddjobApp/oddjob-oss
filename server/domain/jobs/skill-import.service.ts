import { db } from "@server/database_service.js";
import AdmZip from "adm-zip";
import { randomUUID } from "crypto";
import { saasConnectors, apiSpecs, mcpApiTokens } from "@shared/schema/index.js";
import { AGENT_TOOLS, normalizeToolName, isToolAvailable, getToolMetadata } from "../tools/v1/tool-registry.service.js";
import { eq, and } from "drizzle-orm";
import TurndownService from "turndown";
import { marked } from "marked";
import { CircuitBreaker } from "@oddjob/shared-utils";
import { validateUrlForSSRF } from "../../utils/security.js";
import { calculateEntropy } from "../../utils/math.js";

const turndown = new TurndownService();

export interface SecurityReport {
    riskLevel: "low" | "medium" | "high";
    findings: {
        type: "secret" | "suspicious_instruction" | "high_risk_domain";
        message: string;
        severity: "low" | "medium" | "high";
    }[];
    score: number; // 0-100, lower is better
}

export interface ToolMetadata {
    name: string;
    description: string;
    label?: string;
    group?: string;
    adminOnly?: boolean;
}

export interface AnalyzedSkill {
    name: string;
    description: string;
    tools: string[];
    missingDependencies: string[];
    persona: string;
    instructions: string;
    sourceFile: string;
    securityReport?: SecurityReport;
    toolsMetadata?: any[];
    extractedJobs?: {
        name: string;
        description: string;
        language: string;
        code: string;
        type: string;
        matchedConnectorId?: number;
    }[];
    matchedConnectors?: {
        id: number;
        platform: string;
        baseUrl?: string | null;
    }[];
}

export interface DiscoverableSkill {
    name: string;
    description: string;
    author: string;
    sourceUrl: string;
    platform: "skills.sh" | "clawhub" | "github";
    stars?: number;
    tags: string[];
}

export class SkillImportService {
    private static readonly DEFAULT_FETCH_TIMEOUT = 8000; // 8 seconds

    /**
     * Analyze a markdown skill file or zip archive
     */
    static async analyze(buffer: Buffer, originalName: string, organizationId: number): Promise<AnalyzedSkill[]> {
        const extension = originalName.split('.').pop()?.toLowerCase();

        if (extension === 'zip') {
            return this.analyzeZip(buffer, organizationId);
        } else if (extension === 'md') {
            const skill = await this.analyzeMarkdown(buffer.toString('utf-8'), originalName, organizationId);
            return [skill];
        } else if (extension === 'json') {
            const skill = await this.analyzeJson(buffer.toString('utf-8'), originalName, organizationId);
            return [skill];
        } else {
            throw new Error(`Unsupported file type: ${extension}`);
        }
    }

    /**
     * Fetch and analyze a skill from a URL with reliability measures
     */
    static async analyzeUrl(url: string, organizationId: number): Promise<AnalyzedSkill[]> {
        try {
            validateUrlForSSRF(url);

            const response = await this.fetchWithRetry(url, {
                timeout: this.DEFAULT_FETCH_TIMEOUT,
                retries: 2
            });

            if (!response.ok) {
                if (response.status === 404) throw new Error("The requested skill file was not found (404).");
                if (response.status === 403) throw new Error("Access to the skill file was forbidden (403).");
                throw new Error(`Failed to fetch URL: ${response.statusText} (${response.status})`);
            }

            const contentType = response.headers.get("content-type") || "";
            let content = await response.text();

            // If it's HTML, try to convert to markdown or find markdown inside
            if (contentType.includes("text/html")) {
                // Heuristic: Check if this is skills.sh or clawhub.ai
                if (url.includes("skills.sh") || url.includes("clawhub.ai")) {
                    // Try to extract raw github link if present in the page
                    const githubLinkMatch = content.match(/https:\/\/raw\.githubusercontent\.com\/[^"'\s>]+/);
                    if (githubLinkMatch) {
                        const rawUrl = githubLinkMatch[0];
                        console.log(`[SkillImport] Detected skills.sh/github link, re-fetching from raw source: ${rawUrl}`);
                        return this.analyzeUrl(rawUrl, organizationId);
                    }
                    content = turndown.turndown(content);
                } else {
                    content = turndown.turndown(content);
                }

                // Post-process to remove common HTML noise (meta tags, scripts, layout junk)
                content = content
                    .replace(/\\?\"property\\?\"[:=]\\?\"og:[^"]*\\?\"/gi, '') // Remove OG tags
                    .replace(/\\?\"property\\?\"[:=]\\?\"twitter:[^"]*\\?\"/gi, '') // Remove Twitter tags
                    .replace(/\\?\"content\\?\"[:=]\\?\"[^"]*\\?\"/gi, '') // Remove content tags
                    .replace(/\{(\s*\\?\"[^"]*\\?\"\s*:\s*\\?\"[^"]*\\?\",?)*\s*\}/g, '') // Remove JSON-like structures
                    .replace(/\n\s*\n/g, '\n\n') // Normalize whitespace
                    .trim();
            }

            const name = url.split('/').pop() || "Imported Skill";
            const skill = await this.analyzeMarkdown(content, name, organizationId);
            return [skill];
        } catch (error: any) {
            throw new Error(`URL Analysis failed: ${error.message}`);
        }
    }

    /**
     * Helper to enrich tool list with metadata
     */
    private static enrichToolMetadata(tools: string[]): any[] {
        return tools.map(rawTool => getToolMetadata(rawTool));
    }

    /**
     * Extract and analyze skills from a zip archive, supporting OpenClaw Agent Bundles
     */
    private static async analyzeZip(buffer: Buffer, organizationId: number): Promise<AnalyzedSkill[]> {
        const zip = new AdmZip(buffer);
        const entries = zip.getEntries();
        const skills: AnalyzedSkill[] = [];

        // Zip Bomb Mitigation
        const MAX_ENTRIES = 100;
        const MAX_UNCOMPRESSED_SIZE = 50 * 1024 * 1024; // 50MB

        if (entries.length > MAX_ENTRIES) {
            throw new Error(`Zip archive too complex: ${entries.length} entries exceeds limit of ${MAX_ENTRIES}`);
        }

        let totalSize = 0;
        for (const entry of entries) {
            totalSize += entry.header.size;
            if (totalSize > MAX_UNCOMPRESSED_SIZE) {
                throw new Error(`Zip archive too large: exceeds limit of ${MAX_UNCOMPRESSED_SIZE / 1024 / 1024}MB`);
            }
        }

        // Group entries by directory
        const dirGroups: Record<string, AdmZip.IZipEntry[]> = {};
        for (const entry of entries) {
            if (entry.isDirectory) continue;
            const dir = entry.entryName.includes('/') ? entry.entryName.split('/').slice(0, -1).join('/') : ".";
            if (!dirGroups[dir]) dirGroups[dir] = [];
            dirGroups[dir].push(entry);
        }

        for (const [dir, files] of Object.entries(dirGroups)) {
            const skillMd = files.find(f => f.name.toLowerCase() === "skill.md");
            if (skillMd) {
                // This is an Agent Bundle (OpenClaw pattern)
                const bundle = await this.analyzeAgentBundle(files, dir, organizationId);
                skills.push(bundle);
            } else {
                // Individual markdown/json files
                for (const file of files) {
                    if (file.name.endsWith('.md')) {
                        skills.push(await this.analyzeMarkdown(file.getData().toString('utf-8'), file.entryName, organizationId));
                    } else if (file.name.endsWith('.json')) {
                        skills.push(await this.analyzeJson(file.getData().toString('utf-8'), file.entryName, organizationId));
                    }
                }
            }
        }

        return skills;
    }

    /**
     * Analyze a collection of files as a single OpenClaw-style Agent Bundle
     */
    private static async analyzeAgentBundle(files: AdmZip.IZipEntry[], dirName: string, organizationId: number): Promise<AnalyzedSkill> {
        const skillMd = files.find(f => f.name.toLowerCase() === "skill.md")!;
        const soulMd = files.find(f => f.name.toLowerCase() === "soul.md");
        const identityMd = files.find(f => f.name.toLowerCase() === "identity.md");
        const agentsMd = files.find(f => f.name.toLowerCase() === "agents.md");

        const skillContent = skillMd.getData().toString('utf-8');
        const analyzed = await this.analyzeMarkdown(skillContent, skillMd.entryName, organizationId);

        // Merge Persona (SOUL + IDENTITY)
        let combinedPersona = analyzed.persona;
        if (soulMd || identityMd) {
            const soulText = soulMd ? soulMd.getData().toString('utf-8') : "";
            const identityText = identityMd ? identityMd.getData().toString('utf-8') : "";
            combinedPersona = `[Persona from Bundle]\n${identityText}\n\n[Core Values]\n${soulText}`.trim();
        }

        // Merge Safety & Constraints (AGENTS.md)
        let combinedInstructions = analyzed.instructions;
        if (agentsMd) {
            const agentsText = agentsMd.getData().toString('utf-8');
            combinedInstructions = `${combinedInstructions}\n\n## Operational Safety & Constraints\n${agentsText}`;
        }

        return {
            ...analyzed,
            persona: combinedPersona,
            instructions: combinedInstructions,
            sourceFile: `${dirName}/ (Agent Bundle)`
        };
    }

    /**
     * Parse markdown content and extract skill metadata and dependencies
     */
    private static async analyzeMarkdown(content: string, fileName: string, organizationId: number): Promise<AnalyzedSkill> {
        let markdownBody = content;
        let frontmatter: any = {};

        // Extract YAML frontmatter if it exists
        const fmMatch = content.match(/^---\n([\s\S]+?)\n---\n/);
        if (fmMatch) {
            try {
                const yaml = (await import("js-yaml")).default;
                frontmatter = yaml.load(fmMatch[1]);
                markdownBody = content.slice(fmMatch[0].length);
            } catch (e) {
                console.error("Failed to parse YAML frontmatter", e);
            }
        }

        const tokens = marked.lexer(markdownBody);

        // Extract Name (Frontmatter > First H1 > filename)
        let name = frontmatter.name || fileName.replace('.md', '');
        const h1 = tokens.find(t => t.type === 'heading' && (t as any).depth === 1) as any;
        if (h1 && !frontmatter.name) name = h1.text.trim();

        // Extract Description (Frontmatter > First paragraph)
        let description = frontmatter.description || "";
        if (!description) {
            const firstParagraph = tokens.find(t => t.type === 'paragraph') as any;
            if (firstParagraph) description = firstParagraph.text.trim().split('\n')[0];
        }

        // Heuristic: If we have an H1, start instructions from there to skip junk header content
        let instructions = markdownBody;
        if (h1) {
            const h1Pos = markdownBody.indexOf(h1.raw || h1.text);
            if (h1Pos !== -1) {
                instructions = markdownBody.slice(h1Pos);
            }
        }

        // Extract Tools (Frontmatter > Mentions in "Tools" section)
        const tools: string[] = frontmatter.tools || [];
        if (tools.length === 0) {
            let inToolSection = false;
            for (const token of tokens) {
                if (token.type === 'heading' && /Tools|Requirements|Dependencies|Capabilities/i.test((token as any).text)) {
                    inToolSection = true;
                    continue;
                }
                if (inToolSection) {
                    if (token.type === 'heading') {
                        inToolSection = false;
                        continue;
                    }
                    if (token.type === 'list') {
                        for (const item of (token as any).items) {
                            const toolMatch = item.text.match(/`?([^`\s]+)`?/);
                            if (toolMatch) {
                                tools.push(toolMatch[1].trim().toLowerCase());
                            }
                        }
                    }
                }
            }
        }

        // Basic dependency resolution
        const missingDependencies: string[] = [];
        for (const tool of tools) {
            const isAvailable = await isToolAvailable(tool, organizationId);
            if (!isAvailable) {
                missingDependencies.push(tool);
            }
        }

        // Persona Detection (Frontmatter > Content Sections > Keywords)
        let persona = frontmatter.persona || "";

        // Detailed Persona Extraction from Markdown sections
        if (!persona || persona === "generic") {
            let personaSection = "";
            let inPersonaSection = false;

            for (const token of tokens) {
                if (token.type === 'heading' && /Persona|Role|Identity|Who are you/i.test((token as any).text)) {
                    inPersonaSection = true;
                    continue;
                }
                if (inPersonaSection) {
                    if (token.type === 'heading') {
                        inPersonaSection = false;
                        continue;
                    }
                    personaSection += token.raw || "";
                }
            }

            if (personaSection) {
                persona = personaSection.trim();
            } else {
                // Keyword fallback for legacy/simple files
                const lowerContent = markdownBody.toLowerCase();
                if (lowerContent.includes("research") || lowerContent.includes("search")) persona = "researcher";
                else if (lowerContent.includes("critic") || lowerContent.includes("review")) persona = "critic";
                else if (lowerContent.includes("analyze") || lowerContent.includes("data")) persona = "analyst";
                else if (lowerContent.includes("write") || lowerContent.includes("format")) persona = "creator";
                else if (lowerContent.includes("plan") || lowerContent.includes("strategy")) persona = "strategist";
                else if (lowerContent.includes("debug") || lowerContent.includes("fix")) persona = "debugger";
                else persona = "generic";
            }
        }

        // Instructions/Goal refined extraction
        let detectedInstructions = "";
        let inInstructionsSection = false;
        for (const token of tokens) {
            if (token.type === 'heading' && /Instructions|Behavior|Rules|Protocol|Guidelines/i.test((token as any).text)) {
                inInstructionsSection = true;
                continue;
            }
            if (inInstructionsSection) {
                if (token.type === 'heading') {
                    inInstructionsSection = false;
                    continue;
                }
                detectedInstructions += token.raw || "";
            }
        }

        if (detectedInstructions) {
            instructions = detectedInstructions.trim();
        } else if (h1) {
            const h1Pos = markdownBody.indexOf(h1.raw || h1.text);
            if (h1Pos !== -1) {
                instructions = markdownBody.slice(h1Pos).trim();
            }
        }

        // Ensure instructions are markdown (though markdown analysis already returns markdown)
        // If the instructions look like they contain HTML (heuristic), turndown them.
        if (/<[a-z][\s\S]*>/i.test(instructions)) {
            instructions = turndown.turndown(instructions);
        }

        // Check for existing SaaS Connectors
        const connectors = await db
            .select({ id: saasConnectors.id, platform: saasConnectors.platform, baseUrl: saasConnectors.baseUrl, config: saasConnectors.config })
            .from(saasConnectors)
            .where(eq(saasConnectors.orgId, organizationId));

        // Detect if any tools or jobs match these connectors
        const matchedConnectors = connectors.filter(c =>
            tools.some(t => t.toLowerCase() === c.platform.toLowerCase()) ||
            fileName.toLowerCase().includes(c.platform.toLowerCase())
        );

        // Extracted Jobs from code blocks
        const extractedJobs = this.extractJobsFromMarkdown(markdownBody, h1?.text || fileName, connectors);

        return {
            name,
            description,
            tools,
            missingDependencies,
            persona,
            instructions: instructions.trim(),
            sourceFile: fileName,
            securityReport: await this.performSecurityAssessment(instructions, fileName),
            toolsMetadata: this.enrichToolMetadata(tools),
            extractedJobs,
            matchedConnectors
        };
    }

    /**
     * Extract potential jobs from code blocks (CURL, Python, etc.)
     */
    private static extractJobsFromMarkdown(markdown: string, parentName: string, availableConnectors: any[] = []): any[] {
        const jobs: any[] = [];
        const lines = markdown.split('\n');

        let currentHeading = "";
        let inCodeBlock = false;
        let currentLang = "";
        let currentCodeLines: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            if (line.startsWith('#')) {
                currentHeading = line.replace(/^#+\s+/, '');
                continue;
            }

            if (line.startsWith('```')) {
                if (inCodeBlock) {
                    let code = currentCodeLines.join('\n').trim();
                    if (code) {
                        const name = currentHeading || `Job ${jobs.length + 1} from ${parentName}`;
                        const isCurl = currentLang === 'curl' || code.toLowerCase().startsWith('curl');
                        const type = isCurl ? 'curl' : 'code';

                        // Smart Context Substitution (Oddjob Model)
                        // If we have a Jira connector and this looks like a Jira job, substitute the connector's own project key
                        let matchedConnectorId: number | undefined;
                        let isJql = false;

                        if (isCurl || currentLang === 'python') {
                            const isJira = code.toLowerCase().includes('jira') || parentName.toLowerCase().includes('jira');
                            if (isJira) {
                                const jiraConn = availableConnectors.find(c => c.platform === 'jira');

                                // Detect JQL (simple heuristic for "project =", "status =", "jql":)
                                isJql = code.includes('"jql":') || /project\s*=/i.test(code);

                                if (jiraConn) {
                                    matchedConnectorId = jiraConn.id;
                                    // Replace common placeholders with known project context if found in connector config or common patterns
                                    // For Jira, we often see 'PROJ', 'YOUR_PROJECT', or 'project-key'
                                    // Only when the connector names one: placeholders stay
                                    // visible rather than pointing at someone else's project.
                                    const projectKey = jiraConn.config?.defaultProjectKey || jiraConn.config?.project_key;
                                    if (projectKey) {
                                        code = code.replace(/["']?PROJ["']?/g, JSON.stringify(projectKey));
                                        code = code.replace(/["']?YOUR_PROJECT["']?/g, JSON.stringify(projectKey));
                                    }

                                    // If connector has a baseUrl, we could also substitute that
                                    if (jiraConn.baseUrl && code.includes('https://your-domain.atlassian.net')) {
                                        code = code.replace('https://your-domain.atlassian.net', jiraConn.baseUrl.replace(/\/$/, ''));
                                    }
                                }
                            }
                        }

                        jobs.push({
                            name,
                            description: `Extracted from ${parentName} (${currentLang})`,
                            language: isCurl ? 'bash' : currentLang || 'text',
                            code,
                            type,
                            matchedConnectorId,
                            isJql
                        });
                    }
                    inCodeBlock = false;
                    currentCodeLines = [];
                } else {
                    inCodeBlock = true;
                    currentLang = line.replace('```', '').toLowerCase();
                }
                continue;
            }

            if (inCodeBlock) {
                currentCodeLines.push(lines[i]);
            }
        }

        return jobs;
    }

    /**
     * Analyze JSON skill (OpenAPI or proprietary)
     */
    private static async analyzeJson(content: string, fileName: string, organizationId: number): Promise<AnalyzedSkill> {
        try {
            const data = JSON.parse(content);
            let name = data.info?.title || data.name || fileName;
            let description = data.info?.description || data.description || "";
            let instructions = data.instructions || "";
            let persona = data.persona || "";

            // --- Specialized OpenAI Assistant JSON Mapping ---
            // OpenAI exports often have 'instructions' as the massive behavioral prompt
            // and 'name'/'description' as the job metadata.
            if (data.model && data.instructions && !data.goal) {
                // This looks like an OpenAI Assistant export
                instructions = data.instructions;
                persona = data.name || ""; // Use name as persona hint if persona is missing
            }

            // Extract tools from OpenAPI paths or custom JSON
            const tools: string[] = [];
            if (data.paths) {
                // For OpenAPI, tools are often operations
                for (const [path, methods] of Object.entries(data.paths)) {
                    if (typeof methods !== 'object' || methods === null) continue;
                    for (const [method, operation] of Object.entries(methods)) {
                        if (['get', 'post', 'put', 'delete', 'patch'].includes(method.toLowerCase())) {
                            const op = operation as any;
                            const toolName = op.operationId || `${method.toLowerCase()}_${path.replace(/\//g, '_').replace(/[{}]/g, '').replace(/^_/, '')}`;
                            tools.push(toolName);
                        }
                    }
                }
            } else if (data.tools && Array.isArray(data.tools)) {
                tools.push(...data.tools.map((t: any) => typeof t === 'string' ? t : t.name));
            }

            const missingDependencies: string[] = [];
            for (const tool of tools) {
                const isAvailable = await isToolAvailable(tool, organizationId);
                if (!isAvailable) missingDependencies.push(tool);
            }

            // Ensure instructions are markdown
            if (instructions && /<[a-z][\s\S]*>/i.test(instructions)) {
                instructions = turndown.turndown(instructions);
            }

            return {
                name,
                description,
                tools,
                missingDependencies,
                persona: persona || "analyst",
                instructions: instructions || JSON.stringify(data, null, 2),
                sourceFile: fileName,
                securityReport: await this.performSecurityAssessment(content, fileName),
                toolsMetadata: this.enrichToolMetadata(tools)
            };
        } catch (e) {
            throw new Error(`Failed to parse JSON skill: ${fileName}`);
        }
    }

    /**
     * Scan skill content for secrets and malicious patterns
     */
    private static async performSecurityAssessment(content: string, source: string): Promise<SecurityReport> {
        const findings: SecurityReport["findings"] = [];
        let score = 0;

        // 1. Secret Scanning
        const secretPatterns = [
            { name: "Generic API Key", regex: /\b[a-zA-Z0-9]{32,64}\b/g, minEntropy: 3.8 },
            { name: "OpenAI Key", regex: /\bsk-[a-zA-Z0-9]{48}\b/g, minEntropy: 3.5 },
            { name: "Slack Token", regex: /\bxox[baprs]-[a-zA-Z0-9]{10,48}\b/g, minEntropy: 3.5 },
            { name: "GitHub Token", regex: /\bghp_[a-zA-Z0-9]{36}\b/g, minEntropy: 3.5 },
            { name: "Discord Webhook", regex: /https:\/\/discord\.com\/api\/webhooks\/[0-9]+\/[a-zA-Z0-9-]+/g }
        ];

        for (const pattern of secretPatterns) {
            const matches = content.match(pattern.regex);
            if (matches) {
                for (const match of matches) {
                    // Check entropy if specified
                    if (pattern.minEntropy) {
                        const entropy = calculateEntropy(match);
                        if (entropy < pattern.minEntropy) continue; // Skip suspected false positive
                    }

                    findings.push({
                        type: "secret",
                        message: `Potential ${pattern.name} detected in instructions.`,
                        severity: "high"
                    });
                    score += 40;
                    break; // Only report each type once
                }
            }
        }

        // 2. Malicious Instruction Patterns (Refined to reduce false positives)
        const maliciousPatterns = [
            {
                regex: /(send|post|upload|exfiltrate).* (data|secret|credential|token|key|password|payload).*to/i,
                message: "High risk: Instruction to exfiltrate sensitive data detected.",
                severity: "high",
                score: 40
            },
            {
                regex: /(send|post|upload|exfiltrate).*(http|email|to:)/i,
                message: "Suspicious instruction to transmit data externally detected.",
                severity: "medium",
                score: 20
            }
        ];

        // Safe domains that shouldn't trigger "suspicious instruction" for simple links
        const safeDomains = [
            'github.com', 'vercel.com', 'skills.sh', 'clawhub.ai',
            'google.com', 'stackoverflow.com', 'npm.js', 'npmjs.com',
            'microsoft.com', 'apple.com', 'softaworks.com'
        ];

        for (const pattern of maliciousPatterns) {
            const matches = content.match(pattern.regex);
            if (matches) {
                // If it's a medium risk pattern, check if it's just a link to a safe domain
                if (pattern.severity === "medium") {
                    const hasSafeLink = safeDomains.some(domain =>
                        new RegExp(`https?:\\/\\/([^\\/\\s]+\\.)?${domain.replace('.', '\\.')}`, 'i').test(content)
                    );

                    // If it contains a safe link and NOT high-risk keywords, we treat it as low risk or skip
                    const hasHighRiskKeywords = /(data|secret|credential|token|key|password|payload)/i.test(content);

                    if (hasSafeLink && !hasHighRiskKeywords) {
                        continue; // Skip false positive for safe links
                    }
                }

                findings.push({
                    type: "suspicious_instruction",
                    message: (pattern as any).message,
                    severity: (pattern as any).severity as any
                });
                score += (pattern as any).score;
            }
        }

        // 3. Domain Reputation (Naive check)
        if (source.includes("clawhub") && score > 0) {
            findings.push({
                type: "high_risk_domain",
                message: "Source domain (ClawHub) has reported malicious activity recently. Exercise caution.",
                severity: "medium"
            });
            score += 15;
        }

        return {
            riskLevel: score > 50 ? "high" : score > 20 ? "medium" : "low",
            findings,
            score: Math.min(score, 100)
        };
    }


    /**
     * Discover skills from public GitHub repositories.
     *
     * There is no public discovery API for skills.sh or ClawHub today (skills.sh's
     * /api/skills is an open, unimplemented feature request), so GitHub is the only
     * real source. With GITHUB_TOKEN set we use code search to find actual SKILL.md
     * files; without one, code search is unavailable to unauthenticated callers, so
     * we fall back to topic-based repository search.
     */
    static async discoverSkills(query?: string): Promise<DiscoverableSkill[]> {
        const source = "github-skill-discovery";
        const cacheKey = (query ?? "").trim().toLowerCase();

        // Unauthenticated GitHub search allows only 10 requests/min per IP and a single
        // discovery call spends several, so results are cached briefly across callers.
        const cached = this.discoveryCache.get(cacheKey);
        if (cached && Date.now() - cached.at < this.DISCOVERY_CACHE_TTL_MS) {
            return cached.skills;
        }

        if (CircuitBreaker.isOpen(source)) {
            console.warn(`[SkillImport] Circuit breaker open for ${source}; skipping discovery.`);
            return cached?.skills ?? [];
        }

        try {
            const token = process.env.GITHUB_TOKEN;
            const results = token
                ? await this.discoverViaCodeSearch(query, token)
                : await this.discoverViaRepoSearch(query);
            CircuitBreaker.recordSuccess(source);
            this.discoveryCache.set(cacheKey, { at: Date.now(), skills: results });
            return results;
        } catch (error: any) {
            CircuitBreaker.recordFailure(source);
            console.error(`[SkillImport] Discovery failed: ${error.message}`);
            // Serve stale results rather than an empty registry when GitHub is unavailable.
            return cached?.skills ?? [];
        }
    }

    private static readonly DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;
    private static discoveryCache = new Map<string, { at: number; skills: DiscoverableSkill[] }>();

    private static readonly GITHUB_API_BASE = "https://api.github.com";
    private static readonly DISCOVERY_PAGE_SIZE = 30;
    /** Topics polled by the unauthenticated fallback. Kept small: each costs one search request. */
    private static readonly DISCOVERY_TOPICS = ["agent-skills", "claude-skills", "claude-skill", "agent-skill"];
    /** Upper bound on root-SKILL.md probes per discovery call. */
    private static readonly MAX_DISCOVERY_PROBES = 60;

    private static githubHeaders(token?: string): Record<string, string> {
        const headers: Record<string, string> = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Oddjob-SkillImport",
        };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        return headers;
    }

    /**
     * Authenticated path: find real SKILL.md files via GitHub code search.
     */
    private static async discoverViaCodeSearch(query: string | undefined, token: string): Promise<DiscoverableSkill[]> {
        const terms = ["filename:SKILL.md"];
        if (query?.trim()) terms.push(query.trim());
        const url = `${this.GITHUB_API_BASE}/search/code?q=${encodeURIComponent(terms.join(" "))}&per_page=${this.DISCOVERY_PAGE_SIZE}`;

        const response = await this.fetchWithRetry(url, { timeout: 6000, retries: 1, headers: this.githubHeaders(token) });
        if (!response.ok) {
            throw new Error(`GitHub code search failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as { items?: any[] };
        return (data.items ?? []).map(item => {
            const fullName: string = item.repository?.full_name ?? "";
            const path: string = item.path ?? "SKILL.md";
            // "skills/pdf-forms/SKILL.md" -> "pdf-forms"; a root SKILL.md falls back to the repo name.
            const segments = path.split("/").filter(Boolean);
            const dirName = segments.length > 1 ? segments[segments.length - 2] : (item.repository?.name ?? "Skill");

            return {
                name: dirName,
                description: item.repository?.description || `${fullName}/${path}`,
                author: item.repository?.owner?.login ?? fullName.split("/")[0] ?? "unknown",
                sourceUrl: `https://raw.githubusercontent.com/${fullName}/HEAD/${path}`,
                platform: "github" as const,
                tags: [],
            };
        });
    }

    /**
     * Unauthenticated fallback: topic-based repository search.
     *
     * Repository search cannot tell us where a repo keeps its SKILL.md, and many
     * (e.g. anthropics/skills) nest them rather than using the root. Rather than
     * emit URLs that 404 on click, we probe each candidate's root SKILL.md against
     * raw.githubusercontent.com — which does not consume GitHub API rate limit —
     * and return only the repos that actually expose one.
     */
    private static async discoverViaRepoSearch(query: string | undefined): Promise<DiscoverableSkill[]> {
        // Only ~10% of any single topic's repos keep a SKILL.md at the root, so we
        // pool several related topics to leave enough candidates after verification.
        const searches = this.DISCOVERY_TOPICS.map(async topic => {
            const terms = [`topic:${topic}`];
            if (query?.trim()) terms.push(query.trim());
            const url = `${this.GITHUB_API_BASE}/search/repositories?q=${encodeURIComponent(terms.join(" "))}&sort=stars&order=desc&per_page=20`;

            const response = await this.fetchWithRetry(url, { timeout: 6000, retries: 1, headers: this.githubHeaders() });
            if (!response.ok) {
                throw new Error(`GitHub repository search failed for topic '${topic}': ${response.status} ${response.statusText}`);
            }
            return ((await response.json()) as { items?: any[] }).items ?? [];
        });

        const settled = await Promise.allSettled(searches);
        if (settled.every(r => r.status === "rejected")) {
            const reason = settled[0].status === "rejected" ? (settled[0] as PromiseRejectedResult).reason : "unknown";
            throw new Error(`GitHub repository search failed: ${reason}`);
        }

        // Dedupe across topics, strongest first, then bound how many we probe.
        const byFullName = new Map<string, any>();
        for (const result of settled) {
            if (result.status !== "fulfilled") continue;
            for (const repo of result.value) {
                if (repo?.full_name && !byFullName.has(repo.full_name)) byFullName.set(repo.full_name, repo);
            }
        }

        const candidates: DiscoverableSkill[] = [...byFullName.values()]
            .sort((a, b) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0))
            .slice(0, this.MAX_DISCOVERY_PROBES)
            .map(repo => ({
                name: repo.name,
                description: repo.description || repo.full_name,
                author: repo.owner?.login ?? "unknown",
                sourceUrl: `https://raw.githubusercontent.com/${repo.full_name}/HEAD/SKILL.md`,
                platform: "github" as const,
                stars: repo.stargazers_count,
                tags: Array.isArray(repo.topics) ? repo.topics.slice(0, 5) : [],
            }));

        const verified = await Promise.all(
            candidates.map(async skill => (await this.hasReachableSkillFile(skill.sourceUrl)) ? skill : null)
        );
        return verified
            .filter((s): s is DiscoverableSkill => s !== null)
            .slice(0, this.DISCOVERY_PAGE_SIZE);
    }

    /**
     * Cheap existence probe for a raw SKILL.md. Never throws — an unreachable
     * candidate is simply dropped from discovery results.
     */
    private static async hasReachableSkillFile(rawUrl: string): Promise<boolean> {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 3000);
        try {
            const res = await fetch(rawUrl, { method: "HEAD", signal: controller.signal });
            return res.ok;
        } catch {
            return false;
        } finally {
            clearTimeout(id);
        }
    }

    /**
     * Fetch helper with timeout and retry logic
     */
    private static async fetchWithRetry(url: string, options: { timeout?: number, retries?: number, headers?: Record<string, string> } = {}): Promise<Response> {
        const { timeout = 8000, retries = 2, headers } = options;
        let lastError: any;

        for (let i = 0; i <= retries; i++) {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);

            try {
                const response = await fetch(url, { signal: controller.signal, headers });
                clearTimeout(id);

                // Only retry on network errors or 5xx server errors
                if (response.ok || (response.status >= 400 && response.status < 500)) {
                    return response;
                }

                throw new Error(`Server error: ${response.status}`);
            } catch (err: any) {
                clearTimeout(id);
                lastError = err;

                if (err.name === 'AbortError') {
                    console.warn(`Fetch timed out for ${url} (attempt ${i + 1}/${retries + 1})`);
                } else {
                    console.warn(`Fetch failed for ${url}: ${err.message} (attempt ${i + 1}/${retries + 1})`);
                }

                if (i < retries) {
                    const delay = Math.pow(2, i) * 1000;
                    await new Promise(res => setTimeout(res, delay));
                }
            }
        }

        throw lastError;
    }

    /**
     * Confirm a skill import, creating the required jobs and collections
     */
    static async confirmImport(
        skill: AnalyzedSkill,
        extractedJobs: any[],
        organizationId: number,
        userId: number | string
    ): Promise<any> {
        const { jobService } = await import("./job.service.js"); // Lazy import to avoid circular dep if any
        const { AuditEvents } = await import("@domain/audit/core/audit-service.js");
        const userIdStr = userId.toString();

        const allowedTools = [...(skill.tools || [])];
        const createdJobIds: number[] = [];

        // Create extracted jobs if any
        if (Array.isArray(extractedJobs) && extractedJobs.length > 0) {
            for (const extractedJob of extractedJobs) {
                // Aligned with Job Decomposition: Map extracted types to supported schema types
                // http_request -> curl, code -> shell (bash -c)
                let jobType = extractedJob.type;
                let jobConfig: any = {};

                if (jobType === "http_request" || jobType === "curl") {
                    jobType = "curl";
                    // Ensure required CurlConfig fields exist
                    jobConfig = {
                        url: extractedJob.url || extractedJob.code || "",
                        method: extractedJob.method || "POST",
                        headers: extractedJob.headers || {},
                        body: extractedJob.body || extractedJob.code || "",
                        credentialId: extractedJob.matchedConnectorId
                    };
                } else {
                    jobType = "shell";
                    // Map code block to shell executor
                    jobConfig = {
                        executable: extractedJob.language === "python" ? "python3" : "bash",
                        parameters: "-c",
                        workingDirectory: ".",
                    };

                    if (extractedJob.language === "python") {
                        jobType = "python";
                        jobConfig = {
                            scriptContent: extractedJob.code,
                            requirements: ""
                        };
                    } else {
                        // For bash, we use shell but we need to pass the code as a parameter if using -c
                        jobConfig.parameters = `-c "${extractedJob.code.replace(/"/g, '\\"')}"`;
                    }
                }

                const jobInput = {
                    name: extractedJob.name,
                    description: extractedJob.description,
                    type: jobType,
                    config: jobConfig,
                    isActive: false, // Ingest as Draft
                    lifecycleStatus: 'draft',
                    organizationId
                };

                const newJob = await jobService.create(jobInput as any, { userId: userIdStr, organizationId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false });
                createdJobIds.push(newJob.id);
                // Add the new job name to allowedTools so the agent can use it
                allowedTools.push(newJob.name);
            }
        }

        // Create the agent job
        // REFINED MAPPING: Map instructions to System Prompt for behavior, 
        // and use name/description for the high-level Goal to avoid field swap reported by user.
        const jobInput = {
            name: skill.name,
            description: skill.description,
            type: "ai_agent",
            config: {
                goal: skill.description || `Execute tasks for ${skill.name}`,
                systemPrompt: (skill.instructions || "") + (skill.persona ? `\n\n## PERSONA\n${skill.persona}` : ""),
                allowedTools,
                organizationId
            },
            isActive: false, // Ingest as Draft
            lifecycleStatus: 'draft'
        };

        const job = await jobService.create(jobInput as any, { userId: userIdStr, organizationId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false });

        // Create a Job Collection for this skill
        let collectionId: number | undefined;
        try {
            const { jobCollections, jobCollectionItems } = await import("@shared/schema/index.js");
            const { createLogger } = await import("../../utils/logger.js");
            const logger = createLogger('SkillImportService');

            const [collection] = (await db.insert(jobCollections).values({
                name: skill.name,
                description: skill.description || `Imported skill: ${skill.name}`,
                organizationId: organizationId as any,
                createdBy: userId.toString(),
                securityReport: skill.securityReport as any, // Persist security analysis
            }).returning()) as any[];

            if (collection) {
                collectionId = collection.id;
                // Link all jobs to the collection
                const allJobIds = [job.id, ...createdJobIds];
                await db.insert(jobCollectionItems).values(
                    allJobIds.map((jid: number) => ({
                        collectionId: collection.id,
                        jobId: jid
                    }))
                );
                logger.info(`Created job collection ${collection.id} for skill ${skill.name}`);
            }
        } catch (err) {
            console.error(`Failed to create job collection for skill ${skill.name}`, err);
            // Don't fail the whole import if collection creation fails
        }

        // Log grouped skill ingestion with collection ID
        // Passing null for req here since this is pushed down into the service. 
        // AuditEvents should handle a missing request gracefully, or we'd modify AuditEvents.
        await AuditEvents.SKILL_INGESTED(null as any, skill.name, job.id, createdJobIds, collectionId);

        return job;
    }
}


