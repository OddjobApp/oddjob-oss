import { type Server } from "node:http";
import { createLogger } from "./logger.js";

const logger = createLogger("NetworkUtils");

interface BindOptions {
    maxRetries?: number;
    retryDelayMs?: number;
    host?: string;
    onRetry?: (retryCount: number, error: Error) => void;
}

/**
 * Attempts to bind a server to a port with retry logic for EADDRINUSE errors.
 */
export async function bindPortWithRetry(
    server: Server,
    port: number,
    options: BindOptions = {}
): Promise<void> {
    const {
        maxRetries = 5,
        retryDelayMs = 3000,
        // Bind dual-stack (IPv6 unspecified) by default. On Windows `localhost`
        // frequently resolves to IPv6 ::1 first; binding only 0.0.0.0 (IPv4) made
        // browsers hitting http://localhost fail to connect while 127.0.0.1 worked.
        // Node opens a dual-stack socket for "::" (ipv6Only defaults to false), so
        // this accepts both IPv6 (::1) and IPv4 (127.0.0.1) connections.
        host = "::",
        onRetry
    } = options;

    let retriesLeft = maxRetries;

    return new Promise((resolve, reject) => {
        const attempt = () => {
            const errorHandler = (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    if (retriesLeft > 0) {
                        logger.warn(`Port ${port} is in use, retrying in ${retryDelayMs}ms... (${retriesLeft} retries left)`);
                        if (onRetry) onRetry(maxRetries - retriesLeft + 1, err);
                        
                        retriesLeft--;
                        server.removeListener('error', errorHandler);
                        server.removeListener('listening', listeningHandler);
                        
                        setTimeout(attempt, retryDelayMs);
                    } else {
                        logger.error(`Failed to bind to port ${port} after ${maxRetries} retries.`);
                        server.removeListener('error', errorHandler);
                        server.removeListener('listening', listeningHandler);
                        reject(err);
                    }
                } else {
                    server.removeListener('error', errorHandler);
                    server.removeListener('listening', listeningHandler);
                    reject(err);
                }
            };

            const listeningHandler = () => {
                server.removeListener('error', errorHandler);
                server.removeListener('listening', listeningHandler);
                resolve();
            };

            server.on('error', errorHandler);
            server.on('listening', listeningHandler);

            try {
                server.listen(port, host);
            } catch (err) {
                server.removeListener('error', errorHandler);
                server.removeListener('listening', listeningHandler);
                reject(err);
            }
        };

        attempt();
    });
}
