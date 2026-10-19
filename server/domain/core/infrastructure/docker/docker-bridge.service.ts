
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createLogger } from "@server/utils/logger.js";

const execAsync = promisify(exec);
const logger = createLogger("DockerBridge");

export interface ContainerConfig {
    image: string;
    name?: string;
    portMappings?: Record<number, number>;
    env?: Record<string, string>;
    memoryLimitMb?: number;
    cpuLimit?: number;
    volumeMounts?: Array<{ hostPath: string; containerPath: string }>;
    namedVolumes?: Array<{ volumeName: string; containerPath: string }>;
    command?: string;
    restartPolicy?: 'no' | 'always' | 'unless-stopped' | 'on-failure';
}

export const dockerBridgeService = {
    /**
     * Mach 1 Performance: Pre-builds essential mission blueprints.
     */
    async ensureWarmedPool(): Promise<void> {
        if (!(await this.isAvailable())) return;
        
        const essentialImages = [
            { name: "copilotkit-starter", tag: "latest" }
        ];

        for (const img of essentialImages) {
            logger.info(`[Mach 1] Pre-warming ${img.name}:${img.tag}...`);
            // In a real scenario, this would pull or build from blueprints/apps/starter
            // For now, we just ensure Docker is ready to handle these images.
        }
    },

    /**
     * Checks if Docker is available and responding.
     */
    async isAvailable(): Promise<boolean> {
        try {
            await execAsync("docker version", { timeout: 10000 });
            return true;
        } catch (err) {
            logger.warn("Docker is not available in the current environment.");
            return false;
        }
    },

    /**
     * Builds a Docker image from a local directory.
     */
    async buildImage(contextPath: string, imageName: string, tag: string = "latest", extraArgs: string = ""): Promise<{ success: boolean; imageId?: string; error?: string }> {
        const fullImageName = `${imageName}:${tag}`;
        logger.info(`Building Docker image: ${fullImageName} from ${contextPath}`);

        try {
            const { stdout } = await execAsync(`docker build -t ${fullImageName} ${extraArgs} ${contextPath}`, { maxBuffer: 10 * 1024 * 1024, timeout: 600_000 });
            logger.info(`Successfully built image ${fullImageName}`);
            return { success: true, imageId: fullImageName };
        } catch (err: any) {
            const details = [
                err?.message,
                err?.stderr,
                err?.stdout,
            ].filter(Boolean).join("\n");
            logger.error(`Docker build failed for ${fullImageName}: ${details}`);
            return { success: false, error: details || "Docker build failed" };
        }
    },

    /**
     * Runs a containerized app with resource limits.
     */
    async runContainer(config: ContainerConfig): Promise<{ success: boolean; containerId?: string; error?: string }> {
        logger.info(`Launching container: ${config.image}`);

        let command = `docker run -d`;

        if (config.name) command += ` --name ${config.name}`;
        if (config.restartPolicy) command += ` --restart ${config.restartPolicy}`;

        // Resource Limits
        if (config.memoryLimitMb) command += ` --memory=${config.memoryLimitMb}m`;
        if (config.cpuLimit) command += ` --cpus=${config.cpuLimit}`;

        // Port Mappings
        if (config.portMappings) {
            for (const [host, guest] of Object.entries(config.portMappings)) {
                command += ` -p ${host}:${guest}`;
            }
        }

        // Env Vars
        if (config.env) {
            for (const [key, value] of Object.entries(config.env)) {
                command += ` -e ${key}="${value}"`;
            }
        }

        // Bind Mounts (host path)
        if (config.volumeMounts) {
            for (const { hostPath, containerPath } of config.volumeMounts) {
                // On Windows: replace backslashes with forward slashes (C:\foo -> C:/foo).
                // Docker Desktop on Windows accepts this format when called via Node exec / cmd.exe.
                // The /c/foo Git-Bash format is NOT used here because exec runs via cmd.exe.
                const normalizedHost = hostPath.replace(/\\/g, '/');
                command += ` -v "${normalizedHost}:${containerPath}"`;
            }
        }

        // Named Volumes (Docker-managed, survive bind mount shadowing)
        if (config.namedVolumes) {
            for (const { volumeName, containerPath } of config.namedVolumes) {
                command += ` -v ${volumeName}:${containerPath}`;
            }
        }

        // Entrypoint / command override
        if (config.command) {
            command += ` --entrypoint /bin/sh`;
        }

        command += ` ${config.image}`;

        if (config.command) {
            // Use double quotes so the argument works on both Windows cmd.exe and Linux sh.
            // Single quotes are NOT string delimiters in cmd.exe, which breaks the container
            // entrypoint argument when Node.js exec spawns docker via cmd.exe on Windows.
            const escaped = config.command.replace(/"/g, '\\"');
            command += ` -c "${escaped}"`;
        }

        try {
            const { stdout } = await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });
            const containerId = stdout.trim();
            logger.info(`Container ${containerId} launched successfully.`);
            return { success: true, containerId };
        } catch (err: any) {
            const details = [
                err?.message,
                err?.stderr,
                err?.stdout,
            ].filter(Boolean).join("\n");
            logger.error(`Failed to launch container ${config.image}: ${details}`);
            return { success: false, error: details || "Failed to launch container" };
        }
    },

    /**
     * Stops and removes a container.
     */
    async stopContainer(containerId: string): Promise<boolean> {
        try {
            await execAsync(`docker stop ${containerId}`, { timeout: 30000 });
            await execAsync(`docker rm ${containerId}`, { timeout: 10000 });
            logger.info(`Container ${containerId} stopped and removed.`);
            return true;
        } catch (err: any) {
            logger.error(`Failed to stop container ${containerId}: ${err.message}`);
            return false;
        }
    },

    /**
     * Checks whether a named container is currently running.
     */
    async isContainerRunning(containerName: string): Promise<boolean> {
        try {
            const { stdout } = await execAsync(`docker inspect --format="{{.State.Running}}" ${containerName}`, { timeout: 10000 });
            return stdout.trim() === "true";
        } catch {
            return false;
        }
    },

    /**
     * Returns true if a Docker image with the given name:tag exists locally.
     */
    async imageExists(imageRef: string): Promise<boolean> {
        try {
            await execAsync(`docker image inspect ${imageRef} --format "{{.Id}}"`, { timeout: 10000 });
            return true;
        } catch {
            return false;
        }
    },

    /**
     * Removes a named Docker volume. Used to force re-initialisation after a package.json rebuild.
     */
    async deleteVolume(volumeName: string): Promise<boolean> {
        try {
            await execAsync(`docker volume rm ${volumeName}`, { timeout: 10000 });
            logger.info(`Removed Docker volume: ${volumeName}`);
            return true;
        } catch (err: any) {
            // Volume may not exist — not an error
            logger.warn(`Could not remove volume ${volumeName}: ${err.message}`);
            return false;
        }
    },

    /**
     * Fetches the last 200 log lines from a container.
     */
    async getLogs(containerName: string, tail: number = 200): Promise<string[]> {
        const { stdout } = await execAsync(`docker logs --tail ${tail} ${containerName} 2>&1`, { timeout: 20000 });
        return stdout.split("\n").filter(Boolean);
    }
};
