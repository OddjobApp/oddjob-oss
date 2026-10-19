import { lockService } from "./lock-service.js";

const activeLocks = new Map<number, string>();

/**
 * Shared utilities for async step polling and locking.
 * Separated to prevent circular dependencies between async-poller and pipeline hooks.
 */
export const asyncPollerUtils = {
    isProcessing: (id: number) => lockService.isLocked(`step:${id}`),
    lock: async (id: number) => {
        const token = await lockService.acquireLock(`step:${id}`, 300); // 5 min timeout
        if (token) {
            activeLocks.set(id, token);
            return true;
        }
        return false;
    },
    unlock: async (id: number) => {
        const token = activeLocks.get(id);
        const released = await lockService.releaseLock(`step:${id}`, token);
        activeLocks.delete(id);
        return released;
    }
};




