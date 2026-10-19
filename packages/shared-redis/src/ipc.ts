import { Redis } from "ioredis";
import { v4 as uuidv4 } from "uuid";
import { IPCKeys } from "./keys.js";

export interface IPCRequest {
    action: string;
    data: any;
    requestId?: string;
    timeoutMs?: number;
}

export interface IPCResponse<T = any> {
    success: boolean;
    result?: T;
    error?: string;
}

interface PendingRequest {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
    timeoutId: NodeJS.Timeout;
}

export interface IPCLogger {
    info: (msg: string, ...args: any[]) => void;
    error: (msg: string, ...args: any[]) => void;
}

export class RedisStreamRPC {
    private isListening: boolean = false;
    private pendingRequests: Map<string, PendingRequest> = new Map();
    private streamKey: string;
    private groupName: string;
    private consumerName: string;
    private logger: IPCLogger;

    constructor(private redis: Redis, logger?: IPCLogger) {
        this.streamKey = IPCKeys.nodeResponses;
        this.groupName = "node-rpc-group";
        this.consumerName = `node-consumer-${uuidv4()}`;
        this.logger = logger || {
            info: (msg, ...args) => console.log(`[IPC] ${msg}`, ...args),
            error: (msg, ...args) => console.error(`[IPC] ${msg}`, ...args)
        };
    }

    /**
     * Call a Python function via Redis Streams
     */
    async callPython<T = any>(req: IPCRequest): Promise<T> {
        const requestId = req.requestId || uuidv4();
        const timeoutMs = req.timeoutMs || 30000;
        const resultKey = IPCKeys.nodeResults(requestId);

        // 1. Send task
        await this.redis.xadd(
            IPCKeys.pythonTasks,
            "*",
            "requestId", requestId,
            "action", req.action,
            "data", JSON.stringify(req.data)
        );

        // Set expiration for safety
        await this.redis.expire(resultKey, Math.ceil(timeoutMs / 1000) + 60);

        // 2. Wait for result (using BRPOP for efficiency in ad-hoc responses)
        const response = await this.redis.brpop(resultKey, Math.round(timeoutMs / 1000));

        if (!response) {
            throw new Error(`Python IPC timeout after ${timeoutMs}ms (action: ${req.action}, requestId: ${requestId})`);
        }

        const payload: IPCResponse<T> = JSON.parse(response[1]);

        if (!payload.success) {
            throw new Error(`Python IPC error: ${payload.error || 'Unknown error'}`);
        }

        return payload.result as T;
    }

    /**
     * Start listening for responses for this process
     */
    async startListening() {
        if (this.isListening) return;
        this.isListening = true;

        // Ensure consumer group exists
        try {
            await this.redis.xgroup("CREATE", this.streamKey, this.groupName, "$", "MKSTREAM");
            this.logger.info(`Created consumer group ${this.groupName} on ${this.streamKey}`);
        } catch (err: any) {
            if (!err.message.includes("BUSYGROUP")) {
                this.logger.error(`Failed to create consumer group: ${err.message}`);
            }
        }

        this.logger.info(`Started listening for IPC responses on ${this.streamKey}`);

        while (this.isListening) {
            try {
                // ioredis types are sometimes inconsistent with XREADGROUP variants
                const results = await (this.redis as any).xreadgroup(
                    "GROUP", this.groupName, this.consumerName,
                    "COUNT", 10,
                    "BLOCK", 5000,
                    "STREAMS", this.streamKey, ">"
                );

                if (!results) continue;

                for (const [_stream, messages] of (results as any[])) {
                    for (const [id, fields] of (messages as any[])) {
                        const data: Record<string, string> = {};
                        for (let i = 0; i < fields.length; i += 2) {
                            data[fields[i]] = fields[i + 1];
                        }

                        const requestId = data.requestId;
                        const payloadStr = data.payload;
                        const error = data.error;

                        if (requestId && this.pendingRequests.has(requestId)) {
                            const { resolve, reject, timeoutId } = this.pendingRequests.get(requestId)!;
                            clearTimeout(timeoutId);
                            this.pendingRequests.delete(requestId);

                            if (error) {
                                reject(new Error(error));
                            } else {
                                const payload = payloadStr ? JSON.parse(payloadStr) : null;
                                resolve(payload);
                            }
                        }

                        await this.redis.xack(this.streamKey, this.groupName, id);
                    }
                }
            } catch (err: any) {
                this.logger.error(`Error reading from IPC stream: ${err.message}`);
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    /**
     * Call with async streaming support (Wait for message via Stream)
     */
    async callStream<T = any>(req: IPCRequest): Promise<T> {
        const requestId = req.requestId || uuidv4();
        const timeoutMs = req.timeoutMs || 30000;

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error(`IPC Timeout: ${req.action} (${requestId})`));
            }, timeoutMs);

            this.pendingRequests.set(requestId, { resolve, reject, timeoutId });

            this.redis.xadd(
                IPCKeys.pythonTasks,
                "*",
                "requestId", requestId,
                "action", req.action,
                "data", JSON.stringify(req.data)
            ).catch(err => {
                clearTimeout(timeoutId);
                this.pendingRequests.delete(requestId);
                reject(err);
            });
        });
    }
}

