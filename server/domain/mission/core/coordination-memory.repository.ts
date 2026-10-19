import fs from "node:fs/promises";
import path from "node:path";
import { createLogger } from "@server/utils/logger.js";
import type { BlackboardItem, CoordinationTrajectory } from "./multi-agent-coordination.service.js";

const logger = createLogger("CoordinationMemoryRepository");

type MemoryKind = "blackboard" | "trajectory";

function memoryRoot(): string | null {
    if (process.env.NODE_ENV === "test" && !process.env.COORDINATION_MEMORY_DIR) return null;
    return process.env.COORDINATION_MEMORY_DIR || path.resolve(process.cwd(), "storage", "coordination-memory");
}

function serialize(value: unknown): string {
    return JSON.stringify(value, (_key, raw) => raw instanceof Map ? Object.fromEntries(raw) : raw);
}

async function append(kind: MemoryKind, missionId: number, value: unknown): Promise<void> {
    const root = memoryRoot();
    if (!root) return;

    const dir = path.join(root, String(missionId));
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(path.join(dir, `${kind}.jsonl`), `${serialize(value)}\n`, "utf-8");
}

async function readJsonl<T>(kind: MemoryKind, missionId: number): Promise<T[]> {
    const root = memoryRoot();
    if (!root) return [];

    try {
        const raw = await fs.readFile(path.join(root, String(missionId), `${kind}.jsonl`), "utf-8");
        return raw
            .split("\n")
            .filter(Boolean)
            .map(line => JSON.parse(line) as T);
    } catch (err: any) {
        if (err.code === "ENOENT") return [];
        logger.warn(`Failed to read ${kind} memory for mission ${missionId}: ${err.message}`);
        return [];
    }
}

export const coordinationMemoryRepository = {
    appendBlackboardItem(item: BlackboardItem): void {
        void append("blackboard", item.missionId, item).catch(err => {
            logger.warn(`Failed to persist blackboard item ${item.id}: ${err.message}`);
        });
    },

    appendTrajectory(entry: CoordinationTrajectory): void {
        void append("trajectory", entry.missionId, entry).catch(err => {
            logger.warn(`Failed to persist trajectory ${entry.id}: ${err.message}`);
        });
    },

    readBlackboardItems(missionId: number): Promise<BlackboardItem[]> {
        return readJsonl<BlackboardItem>("blackboard", missionId);
    },

    readTrajectories(missionId: number): Promise<CoordinationTrajectory[]> {
        return readJsonl<CoordinationTrajectory>("trajectory", missionId);
    },
};
