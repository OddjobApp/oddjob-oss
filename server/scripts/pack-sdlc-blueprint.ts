import { createLogger } from "../utils/logger.js";
import AdmZip from "adm-zip";
import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";

const logger = createLogger("PackBlueprint");

async function packBlueprint(yamlPath: string, outputZipPath: string) {
    try {
        logger.info(`Packing blueprint: ${yamlPath}`);
        
        // Ensure output dir exists
        await fs.mkdir(path.dirname(outputZipPath), { recursive: true });

        const zip = new AdmZip();
        const rootDir = process.cwd();

        // Read and parse YAML
        const yamlContent = await fs.readFile(yamlPath, 'utf8');
        const manifest = yaml.load(yamlContent) as any;

        // Add the main manifest
        zip.addFile("manifest.yaml", Buffer.from(yamlContent, "utf8"));
        
        let filesAdded = 0;
        const addFileToZip = async (filePath: string) => {
            const relativePath = filePath.replace(/^file:\/\//, "").replace(/\\/g, '/');
            const absolutePath = path.resolve(rootDir, relativePath);
            
            try {
                const content = await fs.readFile(absolutePath);
                zip.addFile(relativePath, content);
                filesAdded++;
                logger.info(`   + Added ${relativePath}`);
            } catch (err: any) {
                logger.error(`   ! Failed to add ${relativePath}: ${err.message}`);
            }
        };

        logger.info("Scanning for referenced files...");

        // 1. Agents (system_prompts)
        if (manifest.agents) {
            for (const agent of manifest.agents) {
                if (typeof agent.system_prompt === "string" && agent.system_prompt.startsWith("file://")) {
                    await addFileToZip(agent.system_prompt);
                }
            }
        }

        // 2. Templates
        if (manifest.templates) {
            for (const template of manifest.templates) {
                if (template.path) {
                    await addFileToZip(template.path);
                }
            }
        }

        // 3. Organizational Guidelines
        if (manifest.guidelines) {
            for (const key in manifest.guidelines) {
                if (manifest.guidelines[key]?.path) {
                    await addFileToZip(manifest.guidelines[key].path);
                }
            }
        }

        // 4. Forms
        if (manifest.forms) {
            for (const form of manifest.forms) {
                if (form.path) {
                    await addFileToZip(form.path);
                }
            }
        }

        // 5. Apps
        if (manifest.apps) {
            for (const app of manifest.apps) {
                if (app.path) {
                    await addFileToZip(app.path);
                }
            }
        }

        logger.info(`Writing archive to ${outputZipPath}...`);
        zip.writeZip(outputZipPath);
        
        logger.info(`✅ Successfully packed manifest.yaml and ${filesAdded} associated files into ${outputZipPath}`);
    } catch (err: any) {
        logger.error(`Failed to pack blueprint: ${err.message}`);
        process.exit(1);
    }
}

// Run if called directly
const inputYaml = process.argv[2] || "server/cycles/hybrid-sdlc.cycle.yaml";
const outputZip = process.argv[3] || "storage/blueprints/hybrid-sdlc.cycle.zip";
packBlueprint(inputYaml, outputZip);
