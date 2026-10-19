import net from "node:net";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("PortAuthority");

const START_PORT = 10000;
const END_PORT = 20000;

const reservedPorts = new Set<number>();

export const portAuthority = {
    /**
     * Checks if a specific port is available on localhost.
     */
    async isPortAvailable(port: number): Promise<boolean> {
        if (reservedPorts.has(port)) return false;
        return new Promise((resolve) => {
            const server = net.createServer();
            server.once("error", () => {
                resolve(false);
            });
            server.once("listening", () => {
                server.close();
                resolve(true);
            });
            server.listen(port);
        });
    },

    /**
     * Finds the first available port in the designated range.
     */
    async findOpenPort(): Promise<number> {
        for (let port = START_PORT; port <= END_PORT; port++) {
            if (await this.isPortAvailable(port)) {
                reservedPorts.add(port);
                logger.debug(`[Mach 3] Found open port: ${port}`);
                return port;
            }
        }
        throw new Error("No available ports found in Mach 3 range.");
    },

    /**
     * Releases a port back to the available pool.
     */
    releasePort(port: number): void {
        reservedPorts.delete(port);
    }
};
