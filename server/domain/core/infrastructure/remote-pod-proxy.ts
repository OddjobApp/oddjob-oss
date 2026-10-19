import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("RemotePodProxy");

export interface RPCRequest {
    podName: string;
    methodName: string;
    args: any[];
    serverId?: string;
}

export interface RPCResponse {
    success: boolean;
    result?: any;
    error?: string;
}

/**
 * A dynamic proxy that forwards method calls to a remote pod via HTTP.
 */
export function createRemotePodProxy<T>(podName: string, remoteUrl: string, apiKey: string): T {
    return new Proxy({} as any, {
        get(target, propKey, receiver) {
            // Ignore special properties and symbols to prevent accidental RPC calls
            if (typeof propKey === "symbol" || propKey === "then" || propKey === "toJSON" || propKey === "constructor") {
                return undefined;
            }

            // If the property is a function, return a function that performs the RPC call
            return async (...args: any[]) => {
                const methodName = propKey.toString();
                logger.debug(`[RPC] Forwarding call: ${podName}.${methodName} to ${remoteUrl}`);

                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000);
                    let response: Response;
                    try {
                        response = await fetch(`${remoteUrl}/api/internal/rpc`, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "X-Internal-RPC-Key": apiKey,
                                "Connection": "keep-alive",
                                "Keep-Alive": "timeout=60"
                            },
                            body: JSON.stringify({ podName, methodName, args } as RPCRequest),
                            signal: controller.signal,
                            // Enable keep-alive for connection pooling
                            keepalive: true
                        });
                    } finally {
                        clearTimeout(timeoutId);
                    }

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`RPC HTTP Error: ${response.status} - ${errorText}`);
                    }

                    const data = (await response.json()) as RPCResponse;

                    if (!data.success) {
                        throw new Error(`RPC Domain Error: ${data.error}`);
                    }

                    return data.result;
                } catch (err: any) {
                    logger.error(`[RPC] Call failed: ${podName}.${methodName}`, err);
                    throw err;
                }
            };
        }
    }) as T;
}
