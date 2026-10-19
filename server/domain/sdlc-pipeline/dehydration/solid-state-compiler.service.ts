import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SolidStateCompilerService");

export interface AssemblyManifestSpec {
  version: string;
  metadata: {
    assembly_id: string;
    created_at: string;
    intent: string;
    author_agent: string;
  };
  spec: {
    runtime: string;
    dependencies: string[];
    capabilities: {
      mcp_servers: Array<{
        name: string;
        endpoint: string;
        schema_ref?: string;
      }>;
    };
    components: Array<{
      name: string;
      entrypoint: string;
      handler: string;
      code_snippet?: string;
      hash?: string;
    }>;
    security_policy: {
      ast_scan_passed: boolean;
      network_egress: {
        allowed_hosts: string[];
      };
      max_memory: string;
      max_cpu: string;
    };
    runtime_policy: {
      port: number;
      timeout_seconds: number;
    };
  };
}

export interface CompilerResult {
  outputDir: string;
  dockerfilePath: string;
  entrypointPath: string;
  requirementsPath: string;
}

export class SolidStateCompilerService {
  /**
   * Compiles an antigravity.assembly.yaml manifest into a production-ready, standalone microservice wrapper.
   */
  async buildSolidStateService(
    manifestYaml: string,
    outputBaseDir: string = path.join(process.cwd(), "dist", "solid-state")
  ): Promise<CompilerResult> {
    const specPayload = yaml.load(manifestYaml) as AssemblyManifestSpec;
    const assemblyId = specPayload.metadata.assembly_id;
    const outputDir = path.join(outputBaseDir, assemblyId);

    logger.info(`[SolidStateCompilerService] Compiling solid-state microservice for ${assemblyId}...`);

    fs.mkdirSync(path.join(outputDir, "src"), { recursive: true });

    const isPython = specPayload.spec.runtime.includes("python");
    const port = specPayload.spec.runtime_policy.port || 8080;
    const comp = specPayload.spec.components[0] || {
      name: "default_handler",
      entrypoint: "src/transform.py",
      handler: "process_payload",
      code_snippet: "def process_payload(payload):\n    return {'processed': True, 'input': payload}"
    };

    let entrypointPath: string;
    let requirementsPath: string;
    let dockerfilePath: string;

    if (isPython) {
      // 1. Write user source component
      const srcPath = path.join(outputDir, "src", "transform.py");
      fs.writeFileSync(srcPath, comp.code_snippet || "def process_payload(payload):\n    return payload\n", "utf-8");

      // 2. Write requirements.txt
      requirementsPath = path.join(outputDir, "requirements.txt");
      const deps = Array.from(new Set([...(specPayload.spec.dependencies || []), "fastapi==0.110.0", "uvicorn==0.28.0"]));
      fs.writeFileSync(requirementsPath, deps.join("\n"), "utf-8");

      // 3. Synthesize FastAPI entrypoint (main.py)
      entrypointPath = path.join(outputDir, "main.py");
      const mainPyCode = `# Auto-generated Solid-State Entrypoint for ${assemblyId}
from fastapi import FastAPI, HTTPException
import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
try:
    from src.transform import ${comp.handler}
except ImportError:
    def ${comp.handler}(payload):
        return {"status": "success", "echo": payload}

app = FastAPI(title="${specPayload.metadata.intent}")

@app.get("/health")
def health():
    return {
        "status": "healthy",
        "assembly_id": "${assemblyId}",
        "version": "${specPayload.version}"
    }

@app.post("/execute")
async def execute(payload: dict):
    try:
        result = ${comp.handler}(payload)
        return {"status": "success", "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
`;
      fs.writeFileSync(entrypointPath, mainPyCode, "utf-8");

      // 4. Synthesize Dockerfile
      dockerfilePath = path.join(outputDir, "Dockerfile");
      const dockerfileContent = `FROM ${specPayload.spec.runtime}

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE ${port}

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "${port}"]
`;
      fs.writeFileSync(dockerfilePath, dockerfileContent, "utf-8");

    } else {
      // Node.js fallback wrapper
      requirementsPath = path.join(outputDir, "package.json");
      fs.writeFileSync(requirementsPath, JSON.stringify({
        name: assemblyId,
        version: "1.0.0",
        type: "module",
        dependencies: { express: "^4.18.2" }
      }, null, 2), "utf-8");

      entrypointPath = path.join(outputDir, "server.js");
      const serverJsCode = `import express from "express";
const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "healthy", assemblyId: "${assemblyId}" }));
app.post("/execute", (req, res) => res.json({ status: "success", data: req.body }));

app.listen(${port}, () => console.log("Solid-state server running on port ${port}"));
`;
      fs.writeFileSync(entrypointPath, serverJsCode, "utf-8");

      dockerfilePath = path.join(outputDir, "Dockerfile");
      fs.writeFileSync(dockerfilePath, `FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
EXPOSE ${port}
CMD ["node", "server.js"]
`, "utf-8");
    }

    logger.info(`[SolidStateCompilerService] Successfully compiled solid-state service to ${outputDir}`);

    return {
      outputDir,
      dockerfilePath,
      entrypointPath,
      requirementsPath,
    };
  }

  /**
   * Triggers docker build to compile the container image tag post-dehydration.
   */
  async triggerContainerBuild(outputDir: string, imageTag: string): Promise<{ success: boolean; imageTag: string; error?: string }> {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    logger.info(`[SolidStateCompilerService] Triggering Docker build for image tag ${imageTag}...`);

    try {
      await execAsync(`docker build -t "${imageTag}" "${outputDir}"`);
      logger.info(`[SolidStateCompilerService] Docker build succeeded for ${imageTag}`);
      return { success: true, imageTag };
    } catch (err: any) {
      logger.warn(`[SolidStateCompilerService] Docker daemon unavailable or build deferred: ${err.message}`);
      return { success: false, imageTag, error: err.message };
    }
  }
}

export const solidStateCompilerService = new SolidStateCompilerService();

