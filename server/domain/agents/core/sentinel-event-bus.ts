
import { EventEmitter } from "events";

export enum SentinelEvent {
    INSIGHT_GENERATED = "INSIGHT_GENERATED",
}

export const sentinelEventBus = new EventEmitter();
