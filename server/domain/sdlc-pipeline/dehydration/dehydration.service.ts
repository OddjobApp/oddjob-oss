import crypto from "crypto";
import yaml from "js-yaml";
import { db } from "@server/database_service.js";
import { assemblyManifests } from "@shared/schema/index.js";
import { solidStateCompilerService, type AssemblyManifestSpec } from "./solid-state-compiler.service.js";
import { astGuardrailService } from "../autonomous/ast-guardrail.service.js";
import { documentTemplateService } from "@domain/knowledge/core/document-template.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("DehydrationService");

export interface DehydrateSessionParams {
  organizationId: number;
  sessionId: string;
  intent: string;
  codeSnippet: string;
  dependencies?: string[];
  mcpServers?: Array<{ name: string; endpoint: string }>;
  runtime?: string;
  port?: number;
}

export class DehydrationService {
  /**
   * Dehydrates an ephemeral execution session into an immutable YAML manifest,
   * stores the record in PostgreSQL, and compiles the solid-state microservice.
   */
  async dehydrateSession(params: DehydrateSessionParams) {
    const {
      organizationId,
      sessionId,
      intent,
      codeSnippet,
      dependencies = ["fastapi==0.110.0", "uvicorn==0.28.0", "pydantic==2.6.4"],
      mcpServers = [{ name: "default-mcp", endpoint: "http://localhost:8080" }],
      runtime = "python:3.11-slim",
      port = 8080,
    } = params;

    logger.info(`[DehydrationService] Dehydrating session ${sessionId} for org ${organizationId}...`);

    // 1. Perform AST Guardrail Verification
    const astResult = astGuardrailService.validateCodeSnippet(codeSnippet, runtime.includes("python") ? "python" : "typescript");

    // 2. Hash code artifact
    const sha256Hash = crypto.createHash("sha256").update(codeSnippet).digest("hex");
    const assemblyId = `asm_${crypto.randomBytes(4).toString("hex")}_prod`;

    // 3. Synthesize Assembly Manifest Specification Structure
    const specPayload: AssemblyManifestSpec = {
      version: "1.0.0",
      metadata: {
        assembly_id: assemblyId,
        created_at: new Date().toISOString(),
        intent,
        author_agent: "antigravity-supervisor-v2",
      },
      spec: {
        runtime,
        dependencies,
        capabilities: {
          mcp_servers: mcpServers,
        },
        components: [
          {
            name: "ephemeral_component_1",
            entrypoint: "src/transform.py",
            handler: "process_payload",
            code_snippet: codeSnippet,
            hash: `sha256:${sha256Hash}`,
          },
        ],
        security_policy: {
          ast_scan_passed: astResult.passed,
          network_egress: {
            allowed_hosts: mcpServers.map(s => s.endpoint),
          },
          max_memory: "512Mi",
          max_cpu: "0.5",
        },
        runtime_policy: {
          port,
          timeout_seconds: 30,
        },
      },
    };

    const manifestYaml = yaml.dump(specPayload);

    // 4. Compile Solid-State Microservice Container Files
    const compilation = await solidStateCompilerService.buildSolidStateService(manifestYaml);

    // 5. Persist Assembly Manifest Record into Database
    const [record] = await db.insert(assemblyManifests)
      .values({
        organizationId,
        assemblyId,
        intent,
        authorAgent: "antigravity-supervisor-v2",
        manifestYaml,
        specPayload: specPayload as any,
        artifactHashes: { "src/transform.py": `sha256:${sha256Hash}` },
        buildStatus: "compiled",
        endpointUrl: `http://localhost:${port}/execute`,
      })
      .returning();

    logger.info(`[DehydrationService] Successfully dehydrated and compiled ${assemblyId}. Endpoint: ${record.endpointUrl}`);

    // 6. Auto-sync into Document Templates catalog (/knowledge/document-templates)
    try {
      await documentTemplateService.create({
        name: `Assembly Manifest — ${assemblyId}`,
        description: `Dehydrated solid-state manifest for ${intent}`,
        category: "assembly_manifest",
        source: "direct",
        type: "markdown",
        content: `\`\`\`yaml\n${manifestYaml}\n\`\`\``,
        createdBy: "antigravity-supervisor-v2"
      }, organizationId);
      logger.info(`[DehydrationService] Synced manifest ${assemblyId} to Document Templates catalog.`);
    } catch (tmplErr: any) {
      logger.warn(`[DehydrationService] Document Templates catalog sync warning: ${tmplErr.message}`);
    }

    return {
      assemblyId,
      record,
      compilation,
      manifestYaml,
    };
  }
}

export const dehydrationService = new DehydrationService();
